<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\EmailChange;
use App\Entity\EmailVerification;
use App\Entity\PasswordReset;
use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Exception\ApiProblemException;
use App\Security\ClientContextResolver;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Forgot / reset password with one-time links.
 *
 * - The token is 32 random bytes (hex); only its SHA-256 hash is stored, so a database leak yields no
 *   usable links. Lookups go through the hash (a unique index), the final comparison uses hash_equals.
 * - A link is valid for 60 minutes and once; a new request replaces the user's open links.
 * - Using a link is a single conditional UPDATE (unused and not expired): of two concurrent requests with
 *   the same token exactly one changes the row and wins.
 * - Resetting proves control of the mailbox: the address counts as confirmed, all sessions end (token
 *   version), open confirmation links and a waiting e-mail change are removed. SSO-only accounts get a
 *   password this way.
 */
readonly class PasswordResetService
{
    public function __construct(
        private EntityManagerInterface $em,
        private UserPasswordHasherInterface $hasher,
        private AccountMailer $mailer,
        private ClockInterface $clock,
        private DeferredMailer $deferred,
        private ClientContextResolver $clientContext,
        private SecurityEventLogger $events,
    ) {
    }

    /**
     * Sends a reset link if the address belongs to an account (also unconfirmed and SSO-only ones). The
     * caller answers the same way in every case. Lookup, token and mail all happen after the response:
     * neither the SMTP round trip nor the database writes for an existing account delay the answer.
     */
    public function requestReset(string $email): void
    {
        $this->deferred->defer(function () use ($email): void {
            $user = $this->em->getRepository(User::class)->findOneBy(['email' => EmailAddress::normalize($email)]);
            if (null === $user) {
                return;
            }
            // The link always goes to the stored address of the account, never to the typed one (the
            // column collation also matches look-alike spellings).
            $this->mailer->sendPasswordReset($user, $this->createToken($user));
        });
    }

    /** Creates a new link token for the user (older open ones become invalid) and returns it. */
    public function createToken(User $user): string
    {
        $now = $this->now();
        $this->em->createQueryBuilder()
            ->delete(PasswordReset::class, 'r')
            ->where('r.user = :user')
            ->andWhere('r.usedAt IS NULL')
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();

        $token = bin2hex(random_bytes(32));
        $this->em->persist(new PasswordReset($user, self::hash($token), $now));
        $this->em->flush();

        return $token;
    }

    /**
     * @throws ApiProblemException 400 invalid_reset_token for unknown, used and expired tokens alike
     */
    public function reset(string $token, string $newPassword): void
    {
        $hash = self::hash($token);
        $now = $this->now()->format('Y-m-d H:i:s');
        $connection = $this->em->getConnection();

        $connection->beginTransaction();
        try {
            $claimed = $connection->executeStatement(
                'UPDATE password_reset SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
                [$now, $hash, $now],
            );
            $row = 1 === $claimed
                ? $connection->fetchAssociative('SELECT user_id, token_hash FROM password_reset WHERE token_hash = ?', [$hash])
                : false;
            if (false === $row || !hash_equals((string) $row['token_hash'], $hash)) {
                throw self::invalidToken();
            }
            $user = $this->em->getRepository(User::class)->find($row['user_id']);
            if (null === $user) {
                throw self::invalidToken();
            }

            // The other open links of this user are void now as well.
            $connection->executeStatement(
                'UPDATE password_reset SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
                [$now, $user->getId()],
            );
            if (!$user->isEmailVerified()) {
                // Like the first confirmation by link: SSO links and passkeys from the unconfirmed time were
                // set up by someone who did not prove to own the address.
                foreach ($user->getOauthAccounts()->toArray() as $account) {
                    $user->getOauthAccounts()->removeElement($account);
                    $this->em->remove($account);
                }
                foreach ($user->getPasskeys()->toArray() as $passkey) {
                    $user->getPasskeys()->removeElement($passkey);
                    $this->em->remove($passkey);
                }
            }
            $user->setPassword($this->hasher->hashPassword($user, $newPassword));
            $user->setIsEmailVerified(true);
            $user->invalidateTokens();
            $this->em->createQueryBuilder()
                ->delete(EmailVerification::class, 'v')
                ->where('v.user = :user')
                ->setParameter('user', $user)
                ->getQuery()
                ->execute();
            // A waiting e-mail change may come from whoever knew the old password: its link would still
            // move the account to their address after this reset.
            $this->em->createQueryBuilder()
                ->delete(EmailChange::class, 'c')
                ->where('c.user = :user')
                ->andWhere('c.usedAt IS NULL')
                ->setParameter('user', $user)
                ->getQuery()
                ->execute();
            $this->em->flush();
            $connection->commit();
        } catch (\Throwable $e) {
            $connection->rollBack();
            throw $e;
        }
        // Notice to the account's address (after the response; no link but "forgot password")
        $context = $this->clientContext->current();
        $this->events->record($user, SecurityEventType::PASSWORD_CHANGED, true, 'reset', null, $context);
        $this->mailer->sendPasswordChanged($user, $context);
    }

    /** Deletes expired links; returns the number of deleted rows. */
    public function pruneExpired(): int
    {
        return (int) $this->em->getConnection()->executeStatement(
            'DELETE FROM password_reset WHERE expires_at < ?',
            [$this->now()->format('Y-m-d H:i:s')],
        );
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private function now(): \DateTimeImmutable
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
    }

    private static function invalidToken(): ApiProblemException
    {
        return new ApiProblemException(400, 'The reset link is invalid or has expired', 'invalid_reset_token', 'token');
    }
}
