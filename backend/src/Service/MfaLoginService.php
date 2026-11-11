<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Exception\ApiProblemException;
use App\Security\NonceStore;
use App\Security\SignedTokenService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Second step of a password sign-in. The first step (AuthService::login) answers with a signed, short-lived
 * `mfaToken` instead of tokens; it is consumed only when the second factor succeeded. Rate limits are the
 * controller's job (they need the claims first, see {@see self::claims()}).
 */
class MfaLoginService
{
    public const string PURPOSE = 'mfa.login';
    public const int TTL = 300;
    public const string METHOD_TOTP = 'totp';
    public const string METHOD_BACKUP = 'backup_code';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SignedTokenService $signedTokens,
        private readonly NonceStore $nonces,
        private readonly MfaService $mfa,
        private readonly WebAuthnService $webAuthn,
        private readonly TokenService $tokens,
        private readonly SecurityEventLogger $events,
    ) {
    }

    public function isRequired(User $user): bool
    {
        return $user->isMfaEnforced() && $user->isEmailVerified();
    }

    /** @return array{mfaRequired: true, mfaToken: string, expiresIn: int, methods: list<string>} */
    public function challenge(User $user): array
    {
        $methods = [];
        if (null !== $this->mfa->status($user)['totp']) {
            $methods[] = self::METHOD_TOTP;
        }
        $methods[] = self::METHOD_BACKUP;
        if (!$user->getPasskeys()->isEmpty()) {
            $methods[] = 'passkey';
        }

        return [
            'mfaRequired' => true,
            'mfaToken' => $this->signedTokens->issue(self::PURPOSE, [
                'sub' => $user->getId(),
                'tv' => $user->getTokenVersion(),
                'jti' => Uuid::v7()->toRfc4122(),
            ], self::TTL),
            'expiresIn' => self::TTL,
            'methods' => $methods,
        ];
    }

    /**
     * Signature, expiry and shape only (no database), so the rate limiter can run before any lookup.
     *
     * @return array{sub: string, tv: int, jti: string, exp: int}
     *
     * @throws ApiProblemException 401 `invalid_mfa_token`
     */
    public function claims(string $mfaToken): array
    {
        $claims = $this->signedTokens->verify(self::PURPOSE, $mfaToken);
        if (null === $claims || !is_string($claims['sub'] ?? null) || !is_int($claims['tv'] ?? null)
            || !is_string($claims['jti'] ?? null) || !is_int($claims['exp'] ?? null)) {
            throw self::invalidToken();
        }

        return ['sub' => $claims['sub'], 'tv' => $claims['tv'], 'jti' => $claims['jti'], 'exp' => $claims['exp']];
    }

    /**
     * The user of a still valid challenge (token version unchanged, MFA still on).
     *
     * @param array{sub: string, tv: int} $claims
     */
    public function userOf(array $claims): User
    {
        $user = $this->em->getRepository(User::class)->find($claims['sub']);
        if (!$user || $user->getTokenVersion() !== $claims['tv'] || !$this->isRequired($user)) {
            throw self::invalidToken();
        }

        return $user;
    }

    /**
     * @param array{sub: string, tv: int, jti: string, exp: int} $claims
     *
     * @return array token response; a backup code additionally ends MFA (`mfaDisabled: true`) and all other sessions
     *
     * @throws ApiProblemException 401 `invalid_mfa_code` (identical for TOTP and backup code), 401 `invalid_mfa_token`
     */
    public function verifyCode(array $claims, string $method, string $code): array
    {
        $user = $this->userOf($claims);
        // A spent token must not burn a code (the nonce itself is consumed only on success, in finish()).
        if ($this->nonces->isConsumed(self::PURPOSE, $claims['jti'])) {
            throw self::invalidToken();
        }
        $ok = self::METHOD_TOTP === $method ? $this->mfa->verifyTotp($user, $code) : $this->mfa->consumeBackupCode($user, $code);
        if (!$ok) {
            $this->events->record($user, SecurityEventType::MFA_VERIFY, false, $method);

            throw new ApiProblemException(401, 'The code is not correct', 'invalid_mfa_code', 'code', ['WWW-Authenticate' => 'Bearer']);
        }

        return $this->finish($user, $claims, $method);
    }

    /**
     * @param array{sub: string, tv: int, jti: string, exp: int} $claims
     *
     * @return array{options: array<string, mixed>, challengeToken: string}
     */
    public function passkeyOptions(array $claims): array
    {
        $user = $this->userOf($claims);
        if ($user->getPasskeys()->isEmpty()) {
            throw new ApiProblemException(400, 'No passkey is registered', 'invalid_request');
        }

        return $this->webAuthn->getMfaOptions($user);
    }

    /**
     * @param array{sub: string, tv: int, jti: string, exp: int} $claims
     * @param array<mixed>                                       $response
     *
     * @throws ApiProblemException 401 `invalid_passkey`, 401 `invalid_mfa_token`
     */
    public function verifyPasskey(array $claims, string $challengeToken, array $response): array
    {
        $user = $this->userOf($claims);
        try {
            $this->webAuthn->verifyMfaAssertion($user, $challengeToken, $response);
        } catch (ApiProblemException $e) {
            $this->events->record($user, SecurityEventType::MFA_VERIFY, false, 'passkey');

            throw $e;
        }

        return $this->finish($user, $claims, 'passkey');
    }

    private function finish(User $user, array $claims, string $method): array
    {
        if (!$this->nonces->consume(self::PURPOSE, $claims['jti'], $claims['exp'])) {
            throw self::invalidToken();
        }
        $this->events->record($user, SecurityEventType::MFA_VERIFY, true, $method);
        if (self::METHOD_BACKUP !== $method) {
            return $this->tokens->tokenResponse($user);
        }
        // Ends all other sessions and MCP grants (token version); the new pair below carries the new version.
        $this->mfa->endEnforcement($user);

        return $this->tokens->tokenResponse($user) + ['mfaDisabled' => true];
    }

    private static function invalidToken(): ApiProblemException
    {
        return new ApiProblemException(401, 'The sign-in has expired or is invalid', 'invalid_mfa_token', null, ['WWW-Authenticate' => 'Bearer']);
    }
}
