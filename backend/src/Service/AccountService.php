<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\EmailChange;
use App\Entity\EmailVerification;
use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Changes to the signed-in user's account: password, e-mail address (confirmed by a link to the new
 * address) and SSO links.
 */
readonly class AccountService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UserPasswordHasherInterface $hasher,
        private TokenService $tokens,
        private AccountMailer $mailer,
        private ClockInterface $clock,
    ) {
    }

    /**
     * Changes the password and ends all sessions (token version), then returns fresh tokens so that the
     * session that made the change continues; other devices have to sign in again. A waiting e-mail
     * change is discarded as well: it may have been started by someone who knew the old password, and
     * its link would otherwise still move the account to their address.
     *
     * @throws ApiProblemException 409 no_password (SSO-only account), 400 invalid_credentials
     */
    public function changePassword(User $user, string $currentPassword, string $newPassword): array
    {
        $this->assertPassword($user, $currentPassword, 'currentPassword');
        $user->setPassword($this->hasher->hashPassword($user, $newPassword));
        $user->invalidateTokens();
        $this->deleteOpenEmailChanges($user);
        $this->em->flush();
        // Notice to the account's address (after the response; no link but "forgot password")
        $this->mailer->sendPasswordChanged($user);

        return $this->tokens->tokenResponse($user);
    }

    /**
     * Starts an e-mail change: the new address gets a confirmation link (24 h), the account keeps its
     * address until then. If the new address already belongs to an account, no mail goes there, but the
     * request looks the same (answer and pending address; no oracle). The current address gets a notice
     * in both cases. `$send = false` (rate limit) sends no mail at all. The caller checks the password first ({@see assertPassword()}); SSO-only accounts cannot change
     * the address (409 no_password): without a password there is no re-authentication.
     */
    public function requestEmailChange(User $user, string $newEmail, bool $send = true): void
    {
        if (0 === strcasecmp($newEmail, $user->getEmail())) {
            throw new ApiProblemException(422, 'This is already your e-mail address', 'validation_failed', 'email');
        }
        $this->deleteOpenEmailChanges($user);
        // The pending change is stored in every case (`pendingEmail` of GET /me must not tell whether the
        // address is taken); only a free address gets the link. For a taken one the token is discarded, so
        // the change can never be confirmed. The lookup uses the column collation (utf8mb4_unicode_ci) like
        // the unique index of user.email: an address that the index would reject counts as taken.
        $token = bin2hex(random_bytes(32));
        $this->em->persist(new EmailChange($user, $newEmail, PasswordResetService::hash($token), $this->now()));
        $this->em->flush();
        if (!$send) {
            return;
        }
        if (null === $this->em->getRepository(User::class)->findOneBy(['email' => $newEmail])) {
            $this->mailer->sendNewEmailConfirmation($user, $newEmail, $token);
        }
        // The current address learns about the request in every case (the new one shown masked). A taken
        // new address never gets a mail (that would let anyone send mails to any account holder).
        $this->mailer->sendEmailChangeRequested($user, $newEmail);
    }

    public function cancelEmailChange(User $user): void
    {
        $this->deleteOpenEmailChanges($user);
    }

    /** The address waiting for confirmation (open, not expired), if any. */
    public function pendingEmail(User $user): ?string
    {
        $pending = $this->em->createQueryBuilder()
            ->select('c.newEmail')
            ->from(EmailChange::class, 'c')
            ->where('c.user = :user')
            ->andWhere('c.usedAt IS NULL')
            ->andWhere('c.expiresAt > :now')
            ->setParameter('user', $user)
            ->setParameter('now', $this->now())
            ->orderBy('c.createdAt', 'DESC')
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();

        return $pending['newEmail'] ?? null;
    }

    /**
     * Opens the confirmation link. Returns 'success', 'invalid', 'expired', 'already_used' or
     * 'email_taken' (the address was taken by another account in the meantime).
     *
     * On success the address changes, counts as confirmed and all sessions end (token version): access
     * tokens carry the old address and are rejected, refresh tokens fail on the version, every device signs
     * in again with the new address.
     */
    public function confirmEmailChange(string $token): string
    {
        if ('' === $token) {
            return 'invalid';
        }
        $hash = PasswordResetService::hash($token);
        $change = $this->em->getRepository(EmailChange::class)->findOneBy(['tokenHash' => $hash]);
        if (null === $change || !hash_equals($change->getTokenHash(), $hash)) {
            return 'invalid';
        }
        if (null !== $change->getUsedAt()) {
            return 'already_used';
        }
        $now = $this->now();
        if ($change->getExpiresAt() <= $now) {
            return 'expired';
        }

        $connection = $this->em->getConnection();
        $connection->beginTransaction();
        try {
            $nowSql = $now->format('Y-m-d H:i:s');
            $claimed = $connection->executeStatement(
                'UPDATE email_change SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?',
                [$nowSql, $change->getId(), $nowSql],
            );
            if (1 !== $claimed) {
                $connection->rollBack();

                return 'already_used';
            }
            $user = $change->getUser();
            $oldEmail = $user->getEmail();
            $newEmail = $change->getNewEmail();
            $taken = $this->em->getRepository(User::class)->findOneBy(['email' => $newEmail]);
            if (null !== $taken && $taken->getId() !== $user->getId()) {
                $connection->commit();

                return 'email_taken';
            }
            $user->setEmail($newEmail);
            $user->setIsEmailVerified(true);
            $user->invalidateTokens();
            $this->em->createQueryBuilder()
                ->delete(EmailVerification::class, 'v')
                ->where('v.user = :user')
                ->setParameter('user', $user)
                ->getQuery()
                ->execute();
            $this->em->flush();
            $connection->commit();
        } catch (UniqueConstraintViolationException) {
            $connection->rollBack();

            return 'email_taken';
        } catch (\Throwable $e) {
            $connection->rollBack();
            throw $e;
        }
        // Notice to the FORMER address: whoever lost the account learns about it
        $this->mailer->sendEmailChanged($user, $oldEmail, $newEmail);

        return 'success';
    }

    /**
     * Removes the user's link to a provider, as long as another way to sign in remains (password,
     * passkey or another provider).
     *
     * @throws ApiProblemException 404 oauth_account_not_found, 409 last_login_method
     */
    public function unlinkProvider(User $user, string $provider): void
    {
        // Two concurrent unlinks (e.g. two tabs) must not both see "another method remains" and leave the
        // account without any: the user row is locked until this one has committed.
        $connection = $this->em->getConnection();
        $connection->beginTransaction();
        try {
            $connection->executeQuery('SELECT id FROM `user` WHERE id = ? FOR UPDATE', [$user->getId()]);
            $this->unlinkLocked($user, $provider);
            $connection->commit();
        } catch (\Throwable $e) {
            $connection->rollBack();
            throw $e;
        }
    }

    private function unlinkLocked(User $user, string $provider): void
    {
        $accounts = $this->em->getRepository(OAuthAccount::class)->findBy(['user' => $user, 'provider' => $provider]);
        if ([] === $accounts) {
            throw new ApiProblemException(404, 'This sign-in method is not linked', 'oauth_account_not_found');
        }
        $otherProviders = $this->em->createQueryBuilder()
            ->select('COUNT(a.id)')
            ->from(OAuthAccount::class, 'a')
            ->where('a.user = :user')
            ->andWhere('a.provider <> :provider')
            ->setParameter('user', $user)
            ->setParameter('provider', $provider)
            ->getQuery()
            ->getSingleScalarResult();
        $remains = null !== $user->getPassword() || $user->getPasskeys()->count() > 0 || (int) $otherProviders > 0;
        if (!$remains) {
            throw new ApiProblemException(409, 'At least one sign-in method must remain', 'last_login_method');
        }
        foreach ($accounts as $account) {
            $user->getOauthAccounts()->removeElement($account);
            $this->em->remove($account);
        }
        $this->em->flush();
    }

    /** Deletes expired e-mail changes; returns the number of deleted rows. */
    public function pruneExpiredEmailChanges(): int
    {
        return (int) $this->em->getConnection()->executeStatement(
            'DELETE FROM email_change WHERE expires_at < ?',
            [$this->now()->format('Y-m-d H:i:s')],
        );
    }

    /**
     * @throws ApiProblemException 409 no_password (SSO-only account), 400 invalid_credentials
     */
    public function assertPassword(User $user, string $password, string $field): void
    {
        if (null === $user->getPassword()) {
            throw new ApiProblemException(409, 'This account has no password', 'no_password');
        }
        if ('' === $password || !$this->hasher->isPasswordValid($user, $password)) {
            throw new ApiProblemException(400, 'The password is not correct', 'invalid_credentials', $field);
        }
    }

    private function deleteOpenEmailChanges(User $user): void
    {
        $this->em->createQueryBuilder()
            ->delete(EmailChange::class, 'c')
            ->where('c.user = :user')
            ->andWhere('c.usedAt IS NULL')
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();
    }

    private function now(): \DateTimeImmutable
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
    }
}
