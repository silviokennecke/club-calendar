<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Entity\User;
use App\Security\NonceStore;
use App\Service\EmailAddress;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;

/**
 * Application layer over {@see OpaqueServer}: registration responses, record storage, login/reauth start and
 * finish with the state sealed into a client-carried blob (single use via NonceStore). Bytes in, bytes out; base64url,
 * rate limits and HTTP errors belong to the controllers.
 *
 * Accounts without a usable record take the fake path, flagged in the sealed state so finishing always fails: an unknown
 * address uses the stable identifier "fake:" || normalized e-mail, an existing account (legacy bcrypt-only,
 * SSO/passkey-only, corrupt record) its user id, so the OPRF output stays the same once it registers a record. The wire
 * answer has the same shape either way (legacy users are indistinguishable without the server secrets). The state carries
 * user id, token version and a record hash; finish takes the user only from the state and re-checks all three.
 */
final class OpaqueService
{
    public const int STATE_TTL = 120;
    public const int CURRENT_VERSION = 1;
    public const string CURRENT_KEY_ID = '1';
    public const string PURPOSE_LOGIN = 'login';
    private const string REAUTH_PREFIX = 'reauth:';
    private const string NONCE_PURPOSE = 'opaque-login-state';
    /** Protocol version -> client KSF profile (not part of the record, plan 2.2). */
    private const array KSF_PROFILES = [1 => 'memory-constrained'];

    private ?OpaqueServer $server = null;

    public function __construct(
        private readonly OpaqueKeys $keys,
        private readonly LoginStateSealer $sealer,
        private readonly OpaqueReauthTickets $tickets,
        private readonly NonceStore $nonces,
        private readonly ClockInterface $clock,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function isEnabled(): bool
    {
        return $this->keys->isEnabled();
    }

    public function hasRecord(User $user): bool
    {
        return null !== $this->parseRecord($user);
    }

    /** KSF profile the client must use for this account (current profile for accounts without a record). */
    public function ksfProfile(?User $user): string
    {
        $version = null !== $user && $this->hasRecord($user) ? $user->getOpaqueVersion() : null;

        return self::KSF_PROFILES[$version ?? self::CURRENT_VERSION] ?? self::KSF_PROFILES[self::CURRENT_VERSION];
    }

    /** evaluated_element | server_public_key for a registration (signup, reset, change, upgrade). */
    public function registrationResponse(User $user, string $request): string
    {
        return $this->server()->createRegistrationResponse($request, $user->getId());
    }

    /** Stores a client record on the entity (192 B, validated); the caller flushes and ends sessions where required. */
    public function storeRecord(User $user, #[\SensitiveParameter] string $record): void
    {
        RegistrationRecord::fromBytes($record);
        $user->setOpaque($record, self::CURRENT_VERSION, self::CURRENT_KEY_ID);
    }

    /** @throws InvalidMessageException on a malformed KE1 */
    public function startLogin(?User $user, string $email, string $ke1): OpaqueLoginChallenge
    {
        return $this->start($user, $email, $ke1, self::PURPOSE_LOGIN);
    }

    /** Re-authentication of the signed-in user for one ticket purpose. */
    public function startReauth(User $user, string $ticketPurpose, string $ke1): OpaqueLoginChallenge
    {
        if (!in_array($ticketPurpose, OpaqueReauthTickets::PURPOSES, true)) {
            throw new OpaqueException('Unknown reauth purpose.');
        }

        return $this->start($user, $user->getEmail(), $ke1, self::REAUTH_PREFIX.$ticketPurpose);
    }

    /**
     * @throws InvalidMessageException       blob unreadable, forged, expired, replayed, wrong purpose or malformed KE3
     * @throws AuthenticationFailedException wrong password, fake-path state, or user/record/sessions changed since the start
     */
    public function finishLogin(string $loginState, string $ke3): User
    {
        return $this->finish($loginState, $ke3, self::PURPOSE_LOGIN);
    }

    /**
     * Verifies KE3 and issues the reauth ticket for the purpose the state was started with.
     *
     * @throws InvalidMessageException|AuthenticationFailedException as {@see finishLogin()}; also when the state belongs to another user
     */
    public function finishReauth(User $user, string $ticketPurpose, string $loginState, string $ke3): string
    {
        if (!in_array($ticketPurpose, OpaqueReauthTickets::PURPOSES, true)) {
            throw new OpaqueException('Unknown reauth purpose.');
        }
        $authenticated = $this->finish($loginState, $ke3, self::REAUTH_PREFIX.$ticketPurpose);
        if ($authenticated->getId() !== $user->getId()) {
            throw new AuthenticationFailedException('Login state belongs to another user.');
        }

        return $this->tickets->issue($user, $ticketPurpose);
    }

    private function start(?User $user, string $email, string $ke1, string $purpose): OpaqueLoginChallenge
    {
        $server = $this->server();
        $record = null !== $user ? $this->parseRecord($user) : null;

        if (null !== $user && null !== $record) {
            $start = $server->generateKE2($ke1, $record, $user->getId());
            $sealed = $this->sealer->seal($start->state, $purpose, $user->getId(), $user->getTokenVersion(), $this->recordHash($user), $this->expiry());
        } else {
            $credentialId = null !== $user ? $user->getId() : 'fake:'.EmailAddress::normalize($email);
            $start = $server->generateFakeKE2($ke1, $credentialId);
            $sealed = $this->sealer->seal($start->state, $purpose, null, 0, str_repeat("\0", LoginStateSealer::HASH_LENGTH), $this->expiry());
        }

        return new OpaqueLoginChallenge($start->ke2, $sealed, $this->ksfProfile($user));
    }

    private function finish(string $loginState, string $ke3, string $purpose): User
    {
        $server = $this->server();
        $opened = $this->sealer->open($loginState);
        if ($opened->purpose !== $purpose || $opened->expiresAt < $this->clock->now()->getTimestamp()) {
            throw new InvalidMessageException('Invalid login state.');
        }
        // One attempt per state: consumed before and regardless of the MAC check.
        if (!$this->nonces->consume(self::NONCE_PURPOSE, bin2hex($opened->jti), $opened->expiresAt)) {
            throw new InvalidMessageException('Login state already used.');
        }

        $server->serverFinish($opened->state, $ke3);
        if ($opened->fake) {
            throw new AuthenticationFailedException('Login failed.');
        }
        $user = $this->em->find(User::class, $opened->userId);
        if (null === $user
            || $user->getTokenVersion() !== $opened->tokenVersion
            || null === $user->getOpaqueRecord()
            || !hash_equals($this->recordHash($user), $opened->recordHash)
        ) {
            throw new AuthenticationFailedException('Account changed since the login started.');
        }

        return $user;
    }

    private function expiry(): int
    {
        return $this->clock->now()->getTimestamp() + self::STATE_TTL;
    }

    private function recordHash(User $user): string
    {
        return hash('sha256', ((int) $user->getOpaqueVersion()).':'.$user->getOpaqueRecord(), true);
    }

    private function parseRecord(User $user): ?RegistrationRecord
    {
        $bytes = $user->getOpaqueRecord();
        if (null === $bytes || self::CURRENT_VERSION !== $user->getOpaqueVersion()) {
            return null;
        }
        try {
            return RegistrationRecord::fromBytes($bytes);
        } catch (InvalidMessageException) {
            $this->logger->error('Stored OPAQUE record is corrupt; answering with the fake path.', ['userId' => $user->getId()]);

            return null;
        }
    }

    private function server(): OpaqueServer
    {
        return $this->server ??= OpaqueServer::fromKeys($this->keys);
    }
}
