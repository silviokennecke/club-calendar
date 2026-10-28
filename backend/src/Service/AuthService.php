<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\ClubUser;
use App\Entity\EmailVerification;
use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Exception\OAuthAccountConflictException;
use App\Exception\OAuthRegistrationRestrictedException;
use App\Repository\RefreshTokenRepository;
use App\Security\NonceStore;
use App\Security\OneTimeTokenService;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Exception\ORMException;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

readonly class AuthService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UserPasswordHasherInterface $hasher,
        private TokenService $tokens,
        private EmailVerificationMailer $verificationMailer,
        private AccountService $accounts,
        private EmailVerificationService $verificationService,
        private OneTimeTokenService $oneTimeTokens,
        private ClockInterface $clock,
        private RefreshTokenRepository $refreshTokens,
        private NonceStore $nonces,
        private ClubService $clubs,
        private LegalConsentService $legal,
        private RegistrationPolicy $registrationPolicy,
        /** Seconds in which a rotated refresh token may be presented again without revoking the session. */
        #[Autowire(env: 'int:REFRESH_TOKEN_REUSE_GRACE')]
        private int $refreshReuseGrace,
        /** Lifetime in seconds of the one-time code the SSO callback puts into the redirect URL. */
        #[Autowire(env: 'int:OAUTH_LOGIN_CODE_TTL')]
        private int $oauthLoginCodeTtl,
    ) {
    }

    /**
     * @param array<mixed> $acceptedDocuments ids of the accepted legal documents (all current ones are required)
     */
    public function register(string $name, string $email, string $password, ?string $language = null, array $acceptedDocuments = [], ?string $ip = null, ?string $userAgent = null): array
    {
        $email = EmailAddress::normalize($email);
        // Before the e-mail-taken check and the hashing
        $accepted = $this->legal->assertAccepted($acceptedDocuments);
        if (!$this->registrationPolicy->mayRegister($email)) {
            throw new ApiProblemException(403, 'Registration is restricted to invited addresses', 'registration_restricted', 'email');
        }
        $existing = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if ($existing) {
            throw new ApiProblemException(400, 'Email already in use', 'email_taken', 'email');
        }
        $user = new User();
        $user->setName($name);
        $user->setEmail($email);
        $user->setPassword($this->hasher->hashPassword($user, $password));
        if (null !== $language && '' !== $language) {
            $user->setLanguage($language);
        }
        $this->em->persist($user);
        $this->em->flush();
        $this->legal->record($user, $accepted, $ip, $userAgent);
        $this->verificationMailer->send($user);

        // Restricted session: only the e-mail confirmation (and the account itself) is reachable until the code was entered.
        return $this->tokens->tokenResponse($user);
    }

    public function login(string $email, string $password): array
    {
        $email = EmailAddress::normalize($email);
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user || !$user->getPassword()) {
            throw self::invalidCredentials();
        }
        if (!$this->hasher->isPasswordValid($user, $password)) {
            throw self::invalidCredentials();
        }
        if (!$user->isEmailVerified()) {
            // Right password, no confirmed address: restricted session; make sure the user has a code to enter.
            $this->sendCodeIfDue($user);
        }

        return $this->tokens->tokenResponse($user);
    }

    private static function invalidCredentials(): ApiProblemException
    {
        return new ApiProblemException(401, 'Invalid credentials', 'invalid_credentials', null, ['WWW-Authenticate' => 'Bearer']);
    }

    private static function invalidRefreshToken(string $message): ApiProblemException
    {
        return new ApiProblemException(401, $message, 'invalid_refresh_token', null, ['WWW-Authenticate' => 'Bearer']);
    }

    /**
     * Mails a fresh code unless one is still waiting to be entered or the last one went out less than
     * EmailVerificationService::RESEND_COOLDOWN ago. A mail that cannot be sent is not an error here: the
     * user can request a code again.
     */
    public function sendCodeIfDue(User $user): void
    {
        if ($this->verificationService->hasActiveCode($user)
            || null !== $this->verificationService->nextSendAt($user)
            || null !== $this->verificationService->lockedUntil($user)) {
            return;
        }
        try {
            $this->verificationMailer->send($user);
        } catch (TransportExceptionInterface) {
        }
    }

    /**
     * Resend action of the signed-in user: nothing when the address is already verified (the caller answers
     * 204 like on success); 429 `verification_resend_too_early` with `retryAt` within the cooldown of the account.
     */
    public function resendVerificationCode(User $user): void
    {
        if ($user->isEmailVerified()) {
            return;
        }
        $locked = $this->verificationService->lockedUntil($user);
        if (null !== $locked) {
            $wait = max(1, $locked->getTimestamp() - $this->clock->now()->getTimestamp());

            throw new ApiProblemException(429, 'Too many codes or attempts for this account', 'rate_limited', null, ['Retry-After' => (string) $wait]);
        }
        $next = $this->verificationService->nextSendAt($user);
        if (null !== $next) {
            $retryAt = $next->setTimezone(new \DateTimeZone('UTC'));
            $wait = max(1, $retryAt->getTimestamp() - $this->clock->now()->getTimestamp());

            throw new ApiProblemException(429, 'A code was sent a moment ago', 'verification_resend_too_early', null, ['Retry-After' => (string) $wait], null, ['retryAt' => $retryAt->format('Y-m-d\TH:i:s\Z')]);
        }
        $this->verificationMailer->send($user);
    }

    /**
     * Confirms the signed-in user's address with the code. The restricted session ends (token version) and a
     * new session (family) is returned.
     */
    public function verifyEmailCode(User $user, string $code): array
    {
        $this->verificationService->verify($user, $code);
        $this->tokens->revokeAllRefreshTokens($user);

        return $this->tokens->tokenResponse($user);
    }

    /** One-time code for the SSO redirect; redeemed at the token endpoint like the e-mail login token. */
    public function issueOAuthLoginCode(User $user): string
    {
        return $this->oneTimeTokens->issue($user, OneTimeTokenService::PURPOSE_OAUTH_LOGIN, $this->oauthLoginCodeTtl);
    }

    /**
     * Token endpoint, grant `one_time_token`: the same token response as login (a restricted session for a user
     * who has not confirmed the address yet). Only the finished SSO sign-in is accepted; no other signed
     * token (state, link ticket, challenge ...).
     */
    public function redeemOneTimeToken(string $token): array
    {
        $user = $this->oneTimeTokens->redeem($token, [OneTimeTokenService::PURPOSE_OAUTH_LOGIN]);
        if (null === $user) {
            throw new ApiProblemException(400, 'The token is invalid, expired or was used before', 'invalid_grant');
        }

        return $this->tokens->tokenResponse($user);
    }

    /**
     * Token endpoint, grant `refresh_token`: rotates the token. Each token is single-use: the conditional
     * UPDATE (`rotated_at IS NULL`) lets exactly one of several parallel requests win. Presenting a token
     * that was already rotated revokes the whole session (family) and fails, except within
     * `REFRESH_TOKEN_REUSE_GRACE` seconds after the rotation: a retry in that window (lost response, parallel
     * tabs) gets a further token of the same family without revoking anything.
     * Legacy tokens without `jti` (issued before rotation existed) are accepted exactly once (nonce store) and
     * replaced by a token of a new session; they are not tracked by family and end at their own expiry (7 days at most).
     */
    public function refresh(string $refreshToken): array
    {
        try {
            $payload = $this->tokens->decodeRefreshToken($refreshToken);
        } catch (\InvalidArgumentException $e) {
            throw self::invalidRefreshToken($e->getMessage());
        }
        $user = is_string($payload['sub'] ?? null) ? $this->em->getRepository(User::class)->find($payload['sub']) : null;
        if (!$user) {
            throw self::invalidRefreshToken('User not found');
        }
        // Sessions end when the account's credentials were revoked (e.g. SSO takeover of an unconfirmed account).
        if (!$this->tokens->isCurrentSession($user, $payload)) {
            throw self::invalidRefreshToken('Refresh token revoked');
        }
        $jti = $payload['jti'] ?? null;
        $family = $payload['fam'] ?? null;
        if (null === $jti && null === $family) {
            // Legacy token: single use, remembered until its own expiry (the nonce store keeps it a bit longer).
            $exp = $payload['exp'] ?? 0;
            if (!is_int($exp) || !$this->nonces->consume('legacy_refresh', $refreshToken, $exp)) {
                throw self::invalidRefreshToken('Refresh token already used');
            }

            return $this->tokens->tokenResponse($user);
        }
        if (!is_string($jti) || !is_string($family)) {
            throw self::invalidRefreshToken('Invalid refresh token');
        }

        $now = $this->tokens->now();
        $state = $this->refreshTokens->findState($jti);
        if (null === $state || $state['user_id'] !== $user->getId() || $state['family_id'] !== $family
            || null !== $state['revoked_at'] || $state['expires_at'] <= $now || $state['family_expires_at'] <= $now) {
            throw self::invalidRefreshToken('Refresh token revoked');
        }
        if (!$this->refreshTokens->markRotated($jti, $now)) {
            // Lost the race or a replay: look at the committed state.
            $state = $this->refreshTokens->findState($jti);
            $rotatedAt = $state['rotated_at'] ?? null;
            if (null === $state || null !== $state['revoked_at'] || null === $rotatedAt) {
                throw self::invalidRefreshToken('Refresh token revoked');
            }
            if ($now->getTimestamp() - $rotatedAt->getTimestamp() > $this->refreshReuseGrace) {
                $this->refreshTokens->revokeFamily($family, $now);
                throw self::invalidRefreshToken('Refresh token reused');
            }
        }

        // The family keeps the consent flag it started with; a token from before the claim existed gets it evaluated once.
        $consentOk = is_bool($payload[TokenService::CONSENT_CLAIM] ?? null) ? $payload[TokenService::CONSENT_CLAIM] : null;

        return $this->tokens->tokenResponse($user, $family, $state['family_expires_at'], $consentOk);
    }

    /**
     * Ends the session of a refresh token (all its tokens). Idempotent and silent: unknown, expired,
     * revoked or malformed tokens do nothing and give no hint.
     */
    public function logout(string $refreshToken): void
    {
        try {
            $payload = $this->tokens->decodeRefreshToken($refreshToken, true);
        } catch (\InvalidArgumentException) {
            return;
        }
        if (is_string($payload['fam'] ?? null)) {
            $this->refreshTokens->revokeFamily($payload['fam'], $this->tokens->now());
        }
    }

    /** Ends all sessions of the user: access tokens (token version) and every refresh token family. */
    public function logoutAll(User $user): void
    {
        $user->invalidateTokens();
        $this->em->flush();
        $this->tokens->revokeAllRefreshTokens($user);
    }

    public function getMe(User $user, bool $sessionConsentOk): array
    {
        // Reload with relations (ignore if entity is detached)
        try {
            $this->em->refresh($user);
        } catch (ORMException) {
            // entity already managed or detached; continue with current state
        }
        $pending = $this->legal->pending($user);

        return [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
            'dateFormat' => $user->getDateFormat(),
            'firstDayOfWeek' => $user->getFirstDayOfWeek(),
            'lastClubId' => $user->getLastClubId(),
            'lastCalendarId' => $user->getLastCalendarId(),
            'language' => $user->getLanguage(),
            'hasPassword' => null !== $user->getPassword(),
            'pendingConsents' => LegalPresenter::pending($pending),
            'consentRequired' => !$sessionConsentOk && [] !== $pending,
            'emailVerificationRequired' => !$user->isEmailVerified(),
            'pendingEmail' => $this->accounts->pendingEmail($user),
            'passkeys' => array_values($user->getPasskeys()->map(fn ($p) => [
                'id' => $p->getId(),
                'deviceName' => $p->getDeviceName(),
                'createdAt' => $p->getCreatedAt()->format(\DateTimeInterface::ATOM),
                'lastUsedAt' => $p->getLastUsedAt()?->setTimezone(new \DateTimeZone('UTC'))->format(\DateTimeInterface::ATOM),
            ])->toArray()),
            // Only the provider: neither the provider's account id (sub) nor its e-mail address.
            'oauthAccounts' => array_values($user->getOauthAccounts()->map(fn ($a) => [
                'provider' => $a->getProvider(),
            ])->toArray()),
        ];
    }

    public function updateMe(User $user, array $data, bool $sessionConsentOk): array
    {
        $this->assertLastIdsAllowed($user, $data);
        if (array_key_exists('name', $data)) {
            $user->setName($data['name']);
        }
        if (array_key_exists('dateFormat', $data)) {
            $user->setDateFormat($data['dateFormat']);
        }
        if (array_key_exists('firstDayOfWeek', $data)) {
            $user->setFirstDayOfWeek($data['firstDayOfWeek']);
        }
        if (array_key_exists('language', $data)) {
            $user->setLanguage($data['language']);
        }
        if (array_key_exists('lastClubId', $data)) {
            $user->setLastClubId($data['lastClubId']);
        }
        if (array_key_exists('lastCalendarId', $data)) {
            $user->setLastCalendarId($data['lastCalendarId']);
            $this->rememberCalendarInMembership($user, $data['lastCalendarId'], $data['lastClubId'] ?? null);
        }
        $this->em->flush();

        return $this->getMe($user, $sessionConsentOk);
    }

    /** Rejects (422 unknown_reference) a lastClubId/lastCalendarId the user has no membership for; nothing is stored. */
    private function assertLastIdsAllowed(User $user, array $data): void
    {
        $clubId = $data['lastClubId'] ?? null;
        $calendarId = $data['lastCalendarId'] ?? null;
        $memberOf = fn (string $id): bool => null !== $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $id, 'user' => $user]);
        if (is_string($clubId) && '' !== $clubId && !$memberOf($clubId)) {
            throw new ApiProblemException(422, 'lastClubId: unknown club', 'unknown_reference', 'lastClubId');
        }
        if (is_string($calendarId) && '' !== $calendarId) {
            $calendar = $this->em->getRepository(Calendar::class)->find($calendarId);
            $calendarClubId = $calendar?->getClub()->getId();
            if (null === $calendarClubId || !$memberOf($calendarClubId)
                || (is_string($clubId) && '' !== $clubId && $clubId !== $calendarClubId)) {
                throw new ApiProblemException(422, 'lastCalendarId: unknown calendar', 'unknown_reference', 'lastCalendarId');
            }
        }
    }

    /**
     * Stores the last opened calendar at the user's membership of the calendar's club (per club, across
     * devices). Inputs are validated beforehand by assertLastIdsAllowed.
     */
    private function rememberCalendarInMembership(User $user, mixed $calendarId, mixed $clubId): void
    {
        if (!is_string($calendarId) || '' === $calendarId) {
            return;
        }
        $calendar = $this->em->getRepository(Calendar::class)->find($calendarId);
        if (null === $calendar || (is_string($clubId) && $calendar->getClub()->getId() !== $clubId)) {
            return;
        }
        $membership = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $calendar->getClub(), 'user' => $user]);
        $membership?->setLastCalendarId($calendar->getId());
    }

    public function deleteMe(User $user): void
    {
        $this->em->wrapInTransaction(function () use ($user): void {
            // L1: a club never loses its last member; the user deletes such a club first.
            $this->clubs->assertNotLastMemberAnywhere($user);
            $this->em->remove($user);
            $this->em->flush();
        });
    }

    /**
     * Providers whose "email_verified" claim is trusted. Microsoft (Entra ID / personal accounts) has no
     * reliable claim: the address in the token can be set by the tenant or the user without proof.
     */
    public const array PROVIDERS_WITH_VERIFIED_EMAIL_CLAIM = ['google', 'apple'];

    /**
     * Signs in with an SSO account.
     *
     * - A known provider account signs in its user.
     * - Otherwise the account is linked to the user with the same e-mail address only if the provider
     *   confirms the address as verified. If that user never confirmed the address (pre-registered by
     *   someone else, or created by an SSO login without verified e-mail), the credentials that did not
     *   prove ownership (password, passkeys, other SSO links, pending confirmations) are removed first.
     * - Without a verified address an existing user is never linked ({@see OAuthAccountConflictException}).
     * - A new user is marked e-mail-verified only if the provider confirms the address. Otherwise (Microsoft)
     *   the user is created unverified and the confirmation code is mailed; the caller signs them in with a
     *   restricted session that only reaches the e-mail confirmation.
     *
     * @throws OAuthAccountConflictException
     */
    public function findOrCreateOAuthUser(string $provider, string $providerId, string $email, string $name, bool $providerSaysEmailVerified = false): User
    {
        $email = EmailAddress::normalize($email);
        $existing = $this->em->getRepository(OAuthAccount::class)->findOneBy([
            'provider' => $provider,
            'providerId' => $providerId,
        ]);
        if ($existing) {
            $oauthUser = $existing->getUser();
            // Only remove orphaned accounts (where getUser() is null)
            if (null === $oauthUser) {
                $this->em->remove($existing);
                $this->em->flush();
            } else {
                if (!$oauthUser->isEmailVerified()) {
                    // Created by a provider that does not prove the address: restricted session until the code was entered.
                    $this->sendCodeIfDue($oauthUser);
                }

                return $oauthUser;
            }
        }
        $emailVerified = $providerSaysEmailVerified
            && in_array($provider, self::PROVIDERS_WITH_VERIFIED_EMAIL_CLAIM, true);

        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if ($user) {
            // The column collation (utf8mb4_unicode_ci) also equates "ä" with "a", "ß" with "ss" or full-width
            // letters: link only if the stored address is exactly the normalized one.
            if (!$emailVerified || $user->getEmail() !== $email) {
                $trustedProvider = in_array($provider, self::PROVIDERS_WITH_VERIFIED_EMAIL_CLAIM, true);
                throw new OAuthAccountConflictException('An account with this e-mail address already exists', $trustedProvider && !$providerSaysEmailVerified);
            }
            if (!$user->isEmailVerified()) {
                $this->revokeUnprovenCredentials($user);
                $user->setIsEmailVerified(true);
            }
        } else {
            if (!$this->registrationPolicy->mayRegister($email)) {
                throw new OAuthRegistrationRestrictedException();
            }
            $user = new User();
            $user->setName($name);
            $user->setEmail($email);
            $user->setIsEmailVerified($emailVerified);
            $this->em->persist($user);
        }
        $account = new OAuthAccount();
        $account->setUser($user);
        $account->setProvider($provider);
        $account->setProviderId($providerId);
        $account->setEmail($email);
        $this->em->persist($account);
        $this->em->flush();

        if (!$user->isEmailVerified()) {
            $this->sendCodeIfDue($user);
        }

        return $user;
    }

    /**
     * Links a provider account to the signed-in user (link mode of the SSO callback). Returns null on
     * success (also when it is already linked to this user) or an error code: account_in_use (the
     * provider account belongs to another user), already_linked (the user has another account of this
     * provider). The provider's e-mail claim is not needed: the user is signed in and controls both.
     */
    public function linkOAuthAccount(User $user, string $provider, string $providerId, ?string $email): ?string
    {
        $repository = $this->em->getRepository(OAuthAccount::class);
        $existing = $repository->findOneBy(['provider' => $provider, 'providerId' => $providerId]);
        if (null !== $existing) {
            return $existing->getUser()->getId() === $user->getId() ? null : 'account_in_use';
        }
        if (null !== $repository->findOneBy(['provider' => $provider, 'user' => $user])) {
            return 'already_linked';
        }
        $account = new OAuthAccount();
        $account->setUser($user);
        $account->setProvider($provider);
        $account->setProviderId($providerId);
        $account->setEmail($email);
        $this->em->persist($account);
        try {
            $this->em->flush();
        } catch (UniqueConstraintViolationException) {
            // Linked concurrently by another user.
            return 'account_in_use';
        }

        return null;
    }

    /**
     * The address was never confirmed for this user, so whoever set up its password, passkeys or other
     * SSO links did not prove to own it. They lose access before the verified owner takes the account.
     */
    private function revokeUnprovenCredentials(User $user): void
    {
        // Ends the sessions as well: tokens issued so far would otherwise keep (and, by refreshing, extend)
        // the access of whoever used the removed credentials. The owner's tokens are issued afterwards.
        $user->invalidateTokens();
        $user->setPassword(null);
        foreach ($user->getPasskeys()->toArray() as $passkey) {
            $user->getPasskeys()->removeElement($passkey);
            $this->em->remove($passkey);
        }
        foreach ($user->getOauthAccounts()->toArray() as $account) {
            $user->getOauthAccounts()->removeElement($account);
            $this->em->remove($account);
        }
        $this->em->createQueryBuilder()
            ->delete(EmailVerification::class, 'v')
            ->where('v.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();
    }
}
