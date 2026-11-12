<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Passkey;
use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Exception\ApiProblemException;
use App\Security\ClientContextResolver;
use App\Security\NonceStore;
use App\Security\SignedTokenService;
use Cose\Algorithm\Manager;
use Cose\Algorithm\Signature\ECDSA\ES256;
use Cose\Algorithm\Signature\RSA\RS256;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Uid\Uuid;
use Webauthn\AttestationStatement\AttestationObject;
use Webauthn\AttestationStatement\AttestationStatementSupportManager;
use Webauthn\AttestationStatement\PackedAttestationStatementSupport;
use Webauthn\AuthenticatorAssertionResponse;
use Webauthn\AuthenticatorAssertionResponseValidator;
use Webauthn\AuthenticatorAttestationResponse;
use Webauthn\AuthenticatorAttestationResponseValidator;
use Webauthn\AuthenticatorSelectionCriteria;
use Webauthn\CeremonyStep\CeremonyStepManagerFactory;
use Webauthn\Counter\ThrowExceptionIfInvalid;
use Webauthn\CredentialRecord;
use Webauthn\Denormalizer\WebauthnSerializerFactory;
use Webauthn\PublicKeyCredential;
use Webauthn\PublicKeyCredentialCreationOptions;
use Webauthn\PublicKeyCredentialParameters;
use Webauthn\PublicKeyCredentialRequestOptions;
use Webauthn\PublicKeyCredentialRpEntity;
use Webauthn\PublicKeyCredentialUserEntity;
use Webauthn\TrustPath\EmptyTrustPath;

/**
 * Passkey registration and sign-in.
 *
 * The API is cookie-less, so the server-generated challenge travels to the client inside an HMAC-signed
 * "challengeToken" (purpose-bound, 5 minutes, bound to the user for registrations). The token is consumed
 * on first use ({@see NonceStore}), and the response is verified with web-auth/webauthn-lib: client data
 * type/challenge/origin, rpIdHash, user presence (and verification if configured), attestation, the
 * signature against the stored public key, the signature counter and the user handle.
 */
class WebAuthnService
{
    private const string PURPOSE_CREATE = 'webauthn.create';
    private const string PURPOSE_GET = 'webauthn.get';
    private const string PURPOSE_MFA = 'webauthn.mfa';
    private const int CHALLENGE_TTL = 300;
    private const int TIMEOUT_MS = 60000;

    private readonly SerializerInterface&DenormalizerInterface $serializer;
    private readonly string $expectedOrigin;
    private readonly CeremonyStepManagerFactory $ceremonies;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly TokenService $tokens,
        private readonly SignedTokenService $signedTokens,
        private readonly NonceStore $nonces,
        private readonly LoggerInterface $logger,
        private readonly SecurityEventLogger $events,
        private readonly MfaService $mfa,
        private readonly AccountMailer $mailer,
        private readonly ClientContextResolver $contextResolver,
        private readonly string $rpId,
        private readonly string $rpName,
        private readonly string $allowedOrigin,
        private readonly string $userVerification = AuthenticatorSelectionCriteria::USER_VERIFICATION_REQUIREMENT_PREFERRED,
    ) {
        $algorithms = Manager::create()->add(ES256::create(), RS256::create());
        $attestationSupport = AttestationStatementSupportManager::create([
            PackedAttestationStatementSupport::create($algorithms),
        ]);
        $serializer = (new WebauthnSerializerFactory($attestationSupport))->create();
        if (!$serializer instanceof DenormalizerInterface) {
            throw new \LogicException('The WebAuthn serializer cannot denormalize');
        }
        $this->serializer = $serializer;

        $this->ceremonies = new CeremonyStepManagerFactory();
        $this->ceremonies->setAlgorithmManager($algorithms);
        $this->ceremonies->setAttestationStatementSupportManager($attestationSupport);
        $this->ceremonies->setAllowedOrigins([$this->allowedOrigin]);
        $this->expectedOrigin = self::serializeOrigin($this->allowedOrigin);
        $this->ceremonies->setCounterChecker(new ThrowExceptionIfInvalid($this->logger));
    }

    public function getRegistrationOptions(User $user): array
    {
        $challenge = random_bytes(32);
        $challengeB64 = SignedTokenService::b64($challenge);
        $challengeToken = $this->signedTokens->issue(
            self::PURPOSE_CREATE,
            ['ch' => $challengeB64, 'sub' => $user->getId()],
            self::CHALLENGE_TTL,
        );

        $excludeCredentials = array_values($user->getPasskeys()->map(fn (Passkey $p) => [
            'type' => 'public-key',
            'id' => SignedTokenService::b64((string) base64_decode($p->getCredentialId(), true)),
        ])->toArray());

        $options = [
            'challenge' => $challengeB64,
            'rp' => ['id' => $this->rpId, 'name' => $this->rpName],
            'user' => [
                'id' => SignedTokenService::b64($user->getId()),
                'name' => $user->getEmail(),
                'displayName' => $user->getName(),
            ],
            'pubKeyCredParams' => [
                ['type' => 'public-key', 'alg' => -7],   // ES256
                ['type' => 'public-key', 'alg' => -257],  // RS256
            ],
            'authenticatorSelection' => [
                'residentKey' => 'preferred',
                'userVerification' => $this->userVerification,
            ],
            'timeout' => self::TIMEOUT_MS,
            'excludeCredentials' => $excludeCredentials,
            'attestation' => 'none',
        ];

        return ['options' => $options, 'challengeToken' => $challengeToken];
    }

    public function verifyRegistration(User $user, string $challengeToken, array $responseData, ?string $deviceName): string
    {
        $claims = $this->signedTokens->verify(self::PURPOSE_CREATE, $challengeToken);
        if (null === $claims || ($claims['sub'] ?? null) !== $user->getId() || !is_string($claims['ch'] ?? null)) {
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }
        if (!$this->nonces->consume(self::PURPOSE_CREATE, $claims['ch'], $claims['exp'])) {
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }

        try {
            $credential = $this->parseCredential($responseData);
            $response = $credential->response;
            // The library accepts either client data type in both ceremonies; insist on the right one.
            if (!$response instanceof AuthenticatorAttestationResponse || 'webauthn.create' !== $response->clientDataJSON->type
                || !$this->isExpectedOrigin($response)) {
                throw new \InvalidArgumentException('Not an attestation response');
            }

            $options = PublicKeyCredentialCreationOptions::create(
                PublicKeyCredentialRpEntity::create($this->rpName, $this->rpId),
                PublicKeyCredentialUserEntity::create($user->getEmail(), $user->getId(), $user->getName()),
                $this->decodeChallenge($claims['ch']),
                [PublicKeyCredentialParameters::createPk(-7), PublicKeyCredentialParameters::createPk(-257)],
                AuthenticatorSelectionCriteria::create(
                    null,
                    $this->userVerification,
                    AuthenticatorSelectionCriteria::RESIDENT_KEY_REQUIREMENT_PREFERRED,
                ),
                PublicKeyCredentialCreationOptions::ATTESTATION_CONVEYANCE_PREFERENCE_NONE,
                [],
                self::TIMEOUT_MS,
            );

            $record = AuthenticatorAttestationResponseValidator::create($this->ceremonies->creationCeremony())
                ->check($response, $options, $this->rpId);
        } catch (\Throwable $e) {
            $this->logger->info('Passkey registration rejected', ['exception' => $e]);
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }

        if (!hash_equals($record->publicKeyCredentialId, $credential->rawId)) {
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }

        $credentialIdStored = base64_encode($record->publicKeyCredentialId);
        if (strlen($credentialIdStored) > 700) { // passkey.credential_id column length
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }
        $existing = $this->em->getRepository(Passkey::class)->findOneBy(['credentialId' => $credentialIdStored]);
        if ($existing) {
            throw new ApiProblemException(400, 'Credential already registered', 'passkey_already_registered');
        }

        $passkey = new Passkey();
        $passkey->setId($this->generateCuid());
        $passkey->setUser($user);
        $passkey->setCredentialId($credentialIdStored);
        $passkey->setPublicKey($record->credentialPublicKey);
        $passkey->setCounter($record->counter);
        $passkey->setDeviceName($deviceName);

        $this->em->persist($passkey);
        $this->em->flush();

        $context = $this->contextResolver->current();
        $this->events->record($user, SecurityEventType::PASSKEY_ADDED, true, 'passkey', null, $context);
        $this->mailer->sendPasskeyAdded($user, (string) $deviceName, $context);

        return $passkey->getId();
    }

    public function getAuthenticationOptions(): array
    {
        $challenge = random_bytes(32);
        $challengeB64 = SignedTokenService::b64($challenge);
        $challengeToken = $this->signedTokens->issue(self::PURPOSE_GET, ['ch' => $challengeB64], self::CHALLENGE_TTL);

        $options = [
            'challenge' => $challengeB64,
            'rpId' => $this->rpId,
            'timeout' => self::TIMEOUT_MS,
            'userVerification' => $this->userVerification,
            'allowCredentials' => [],
        ];

        return ['options' => $options, 'challengeToken' => $challengeToken];
    }

    /**
     * Every failure ends in the same 401, so the response does not reveal whether a credential ID exists.
     */
    public function verifyAuthentication(string $challengeToken, array $responseData): array
    {
        $claims = $this->signedTokens->verify(self::PURPOSE_GET, $challengeToken);
        if (null === $claims || !is_string($claims['ch'] ?? null)
            || !$this->nonces->consume(self::PURPOSE_GET, $claims['ch'], $claims['exp'])) {
            throw $this->authenticationFailed();
        }

        [$passkey, $updated] = $this->checkAssertion($claims, $responseData, null);
        $user = $passkey->getUser();

        if (!$user->isEmailVerified()) {
            $this->events->record($user, SecurityEventType::LOGIN, false, 'passkey');

            throw $this->authenticationFailed();
        }

        $this->applyAssertion($passkey, $updated);
        $this->events->record($user, SecurityEventType::LOGIN, true, 'passkey');

        return $this->tokens->tokenResponse($user);
    }

    /**
     * Assertion options for the MFA step of a password sign-in: only the user's own passkeys are allowed.
     *
     * @return array{options: array<string, mixed>, challengeToken: string}
     */
    public function getMfaOptions(User $user): array
    {
        $challengeB64 = SignedTokenService::b64(random_bytes(32));
        $challengeToken = $this->signedTokens->issue(
            self::PURPOSE_MFA,
            ['ch' => $challengeB64, 'sub' => $user->getId()],
            self::CHALLENGE_TTL,
        );
        $allow = array_values($user->getPasskeys()->map(fn (Passkey $p) => [
            'type' => 'public-key',
            'id' => SignedTokenService::b64((string) base64_decode($p->getCredentialId(), true)),
        ])->toArray());

        return ['options' => [
            'challenge' => $challengeB64,
            'rpId' => $this->rpId,
            'timeout' => self::TIMEOUT_MS,
            'userVerification' => $this->userVerification,
            'allowCredentials' => $allow,
        ], 'challengeToken' => $challengeToken];
    }

    /**
     * Verifies the second-factor assertion; the credential must belong to `$user`. Failures are the same 401
     * as at passkey sign-in; the caller logs the MFA event.
     *
     * @throws ApiProblemException 401 `invalid_passkey`
     */
    public function verifyMfaAssertion(User $user, string $challengeToken, array $responseData): void
    {
        $claims = $this->signedTokens->verify(self::PURPOSE_MFA, $challengeToken);
        if (null === $claims || !is_string($claims['ch'] ?? null) || ($claims['sub'] ?? null) !== $user->getId()
            || !$this->nonces->consume(self::PURPOSE_MFA, $claims['ch'], $claims['exp'])) {
            throw $this->authenticationFailed();
        }

        [$passkey, $updated] = $this->checkAssertion($claims, $responseData, $user);
        $this->applyAssertion($passkey, $updated);
    }

    /**
     * Parses and validates an assertion. Without `$expectedUser` the credential identifies the user (login,
     * failures are logged as login events); with it the credential must belong to that user and the
     * user handle is checked against it.
     *
     * @param array<string, mixed> $claims
     *
     * @return array{0: Passkey, 1: CredentialRecord}
     */
    private function checkAssertion(array $claims, array $responseData, ?User $expectedUser): array
    {
        try {
            $credential = $this->parseCredential($responseData);
            $response = $credential->response;
            if (!$response instanceof AuthenticatorAssertionResponse || 'webauthn.get' !== $response->clientDataJSON->type
                || !$this->isExpectedOrigin($response)) {
                throw new \InvalidArgumentException('Not an assertion response');
            }
        } catch (\Throwable $e) {
            $this->logger->info('Passkey sign-in rejected: unreadable response', ['exception' => $e]);
            throw $this->authenticationFailed();
        }

        $passkey = $this->em->getRepository(Passkey::class)->findOneBy(['credentialId' => base64_encode($credential->rawId)]);
        if (!$passkey || (null !== $expectedUser && $passkey->getUser()->getId() !== $expectedUser->getId())) {
            throw $this->authenticationFailed();
        }
        $user = $passkey->getUser();

        try {
            $record = CredentialRecord::create(
                $credential->rawId,
                'public-key',
                [],
                'none',
                EmptyTrustPath::create(),
                Uuid::fromString('00000000-0000-0000-0000-000000000000'),
                $this->cosePublicKey($passkey, $credential->rawId),
                $user->getId(),
                $passkey->getCounter(),
            );
            $options = PublicKeyCredentialRequestOptions::create(
                $this->decodeChallenge($claims['ch']),
                $this->rpId,
                [],
                $this->userVerification,
                self::TIMEOUT_MS,
            );

            // Login: userHandle null, the response must carry the handle and it must match the credential's owner.
            $updated = AuthenticatorAssertionResponseValidator::create($this->ceremonies->requestCeremony())
                ->check($record, $response, $options, $this->rpId, $expectedUser?->getId());
        } catch (\Throwable $e) {
            $this->logger->warning('Passkey sign-in rejected', ['passkey' => $passkey->getId(), 'exception' => $e]);
            if (null === $expectedUser) {
                $this->events->record($user, SecurityEventType::LOGIN, false, 'passkey');
            }
            throw $this->authenticationFailed();
        }

        return [$passkey, $updated];
    }

    private function applyAssertion(Passkey $passkey, CredentialRecord $updated): void
    {
        $passkey->setCounter($updated->counter);
        $passkey->setPublicKey($updated->credentialPublicKey);
        $passkey->setLastUsedAt($this->signedTokens->now()->setTimezone(new \DateTimeZone('UTC')));
        $this->em->flush();
    }

    /**
     * Removes a passkey and ends all sessions (token version, refresh tokens): whoever signed in with it
     * must not stay signed in. Returns fresh tokens so that the session that made the change continues.
     */
    public function deletePasskey(string $id, User $user, ?bool $consentOk = null): array
    {
        // The user row lock makes "not the last passkey" and the delete one step: two parallel deletes serialise.
        $this->em->wrapInTransaction(function () use ($id, $user): void {
            $this->em->refresh($user, LockMode::PESSIMISTIC_WRITE);
            $passkey = $this->em->getRepository(Passkey::class)->find($id);
            if (!$passkey || $passkey->getUser()->getId() !== $user->getId()) {
                throw new ApiProblemException(404, 'Passkey not found', 'passkey_not_found');
            }
            $this->mfa->assertPasskeyDeletable($user);
            $this->em->remove($passkey);
            $user->invalidateTokens();
            $this->em->flush();
        });
        $this->tokens->revokeAllRefreshTokens($user);
        $context = $this->contextResolver->current();
        $this->events->record($user, SecurityEventType::PASSKEY_DELETED, true, 'passkey', null, $context);
        $this->mailer->sendPasskeyDeleted($user, $context);

        return $this->tokens->tokenResponse($user, null, null, $consentOk);
    }

    public function renamePasskey(string $id, User $user, string $deviceName): void
    {
        $passkey = $this->em->getRepository(Passkey::class)->find($id);
        if (!$passkey || $passkey->getUser()->getId() !== $user->getId()) {
            throw new ApiProblemException(404, 'Passkey not found', 'passkey_not_found');
        }
        $passkey->setDeviceName($deviceName);
        $this->em->flush();
    }

    private function authenticationFailed(): ApiProblemException
    {
        return new ApiProblemException(401, 'Invalid passkey', 'invalid_passkey', null, ['WWW-Authenticate' => 'Bearer']);
    }

    private function parseCredential(array $responseData): PublicKeyCredential
    {
        $credential = $this->serializer->deserialize(
            json_encode($responseData, \JSON_THROW_ON_ERROR),
            PublicKeyCredential::class,
            'json',
        );
        if (!$credential instanceof PublicKeyCredential || 'public-key' !== $credential->type) {
            throw new \InvalidArgumentException('Invalid credential');
        }

        return $credential;
    }

    /**
     * The library compares origins after parse_url() normalisation (which also accepts e.g. a trailing NUL
     * or a path); browsers send the serialised origin, so it must match exactly. The frontend never runs in
     * a cross-origin iframe, so such a ceremony is rejected too.
     */
    private function isExpectedOrigin(AuthenticatorAssertionResponse|AuthenticatorAttestationResponse $response): bool
    {
        return $response->clientDataJSON->origin === $this->expectedOrigin && true !== $response->clientDataJSON->crossOrigin;
    }

    private static function serializeOrigin(string $url): string
    {
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            throw new \InvalidArgumentException('FRONTEND_URL must be an absolute URL');
        }
        $scheme = strtolower($parts['scheme']);
        $port = $parts['port'] ?? null;
        $defaultPort = ['https' => 443, 'http' => 80][$scheme] ?? null;

        return $scheme.'://'.strtolower($parts['host']).(null !== $port && $port !== $defaultPort ? ':'.$port : '');
    }

    private function decodeChallenge(string $challengeB64): string
    {
        $bytes = base64_decode(strtr($challengeB64, '-_', '+/'), true);
        if (false === $bytes || 32 !== strlen($bytes)) {
            throw new \InvalidArgumentException('Invalid challenge');
        }

        return $bytes;
    }

    /**
     * Passkeys registered before the verified flow stored the whole attestation object instead of the
     * COSE public key; the key is taken from its attested credential data (and rewritten on success).
     */
    private function cosePublicKey(Passkey $passkey, string $credentialId): string
    {
        $stored = $passkey->getPublicKey();
        try {
            $attestation = $this->serializer->denormalize($stored, AttestationObject::class);
        } catch (\Throwable) {
            return $stored;
        }
        $data = $attestation instanceof AttestationObject ? $attestation->authData->attestedCredentialData : null;
        if (null === $data || null === $data->credentialPublicKey || !hash_equals($data->credentialId, $credentialId)) {
            throw new \RuntimeException('Stored passkey has no usable public key');
        }

        return $data->credentialPublicKey;
    }

    private function generateCuid(): string
    {
        return 'c'.bin2hex(random_bytes(12));
    }
}
