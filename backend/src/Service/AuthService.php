<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\ClubUser;
use App\Entity\EmailVerification;
use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Exception\EmailNotVerifiedException;
use App\Exception\OAuthAccountConflictException;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Exception\ORMException;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

readonly class AuthService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UserPasswordHasherInterface $hasher,
        private TokenService $tokens,
        private EmailVerificationMailer $verificationMailer,
        private AccountService $accounts,
    ) {
    }

    public function register(string $name, string $email, string $password, ?string $language = null): void
    {
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
        $this->verificationMailer->send($user);
    }

    public function login(string $email, string $password): array
    {
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user || !$user->getPassword()) {
            throw self::invalidCredentials();
        }
        if (!$this->hasher->isPasswordValid($user, $password)) {
            throw self::invalidCredentials();
        }
        if (!$user->isEmailVerified()) {
            throw new EmailNotVerifiedException();
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

    public function sendVerificationEmail(User $user): void
    {
        $this->verificationMailer->send($user);
    }

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

        return $this->tokens->tokenResponse($user);
    }

    public function getMe(User $user): array
    {
        // Reload with relations (ignore if entity is detached)
        try {
            $this->em->refresh($user);
        } catch (ORMException) {
            // entity already managed or detached; continue with current state
        }

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

    public function updateMe(User $user, array $data): array
    {
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

        return [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
            'dateFormat' => $user->getDateFormat(),
            'firstDayOfWeek' => $user->getFirstDayOfWeek(),
            'language' => $user->getLanguage(),
            'lastClubId' => $user->getLastClubId(),
            'lastCalendarId' => $user->getLastCalendarId(),
        ];
    }

    /**
     * Stores the last opened calendar at the user's membership of the calendar's club (per club, across
     * devices). Ignored, without an error, when the calendar is unknown, belongs to another club than the
     * given lastClubId, or the user is not a member of its club.
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
        $this->em->remove($user);
        $this->em->flush();
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
     * - A new user is marked e-mail-verified only if the provider confirms the address.
     *
     * @throws OAuthAccountConflictException
     */
    public function findOrCreateOAuthUser(string $provider, string $providerId, string $email, string $name, bool $providerSaysEmailVerified = false): array
    {
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
                // Valid OAuth account found, return tokens for the associated user
                return $this->tokens->tokenResponse($oauthUser);
            }
        }
        $emailVerified = $providerSaysEmailVerified
            && in_array($provider, self::PROVIDERS_WITH_VERIFIED_EMAIL_CLAIM, true);

        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if ($user) {
            // The column collation (utf8mb4_unicode_ci) also equates "ä" with "a", "ß" with "ss" or full-width
            // letters: link only if the addresses are the same apart from ASCII letter case.
            if (!$emailVerified || 0 !== strcasecmp($user->getEmail(), $email)) {
                $trustedProvider = in_array($provider, self::PROVIDERS_WITH_VERIFIED_EMAIL_CLAIM, true);
                throw new OAuthAccountConflictException('An account with this e-mail address already exists', $trustedProvider && !$providerSaysEmailVerified);
            }
            if (!$user->isEmailVerified()) {
                $this->revokeUnprovenCredentials($user);
                $user->setIsEmailVerified(true);
            }
        } else {
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

        return $this->tokens->tokenResponse($user);
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
