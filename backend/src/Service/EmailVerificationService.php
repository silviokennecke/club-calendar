<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\EmailVerification;
use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\PasswordHasher\Hasher\PasswordHasherFactoryInterface;
use Symfony\Component\PasswordHasher\PasswordHasherInterface;

/**
 * E-mail confirmation by a 6-digit code that goes out by mail only (no link).
 *
 * The code comes from the CSPRNG and is stored only as a hash of the `verification_code` password hasher
 * (bcrypt, security.yaml; its verify() compares in constant time). APP_SECRET is the pepper: the hasher gets
 * HMAC-SHA256(APP_SECRET, row id + code) as its input, so a database leak alone does not allow guessing the
 * 10^6 codes offline. It is valid {@see CODE_TTL} seconds, works once, and a new code
 * invalidates the older ones. Every guess counts atomically in the database (a conditional UPDATE), so
 * parallel requests cannot exceed {@see MAX_ATTEMPTS}; the code is dead after the last one and a new one
 * must be requested. Per account, within 24 hours, at most {@see MAX_CODES_PER_DAY} codes are issued and
 * {@see MAX_ATTEMPTS_PER_DAY} guesses count in total ({@see lockedUntil()}): forcing new codes does not
 * widen the guessing budget. Every failure is the same `invalid_verification_code` (wrong, expired, used up,
 * already verified). The caller is the signed-in (restricted) user the code belongs to, so the mailbox
 * owner without a session cannot confirm an account that someone else registered.
 */
readonly class EmailVerificationService
{
    public const int CODE_TTL = 900;
    public const int MAX_ATTEMPTS = 5;
    /** Minimum time between two code mails of one account. */
    public const int RESEND_COOLDOWN = 300;
    /** Per account and rolling 24 hours (rows are never deleted on invalidation, so they count): codes issued ... */
    public const int MAX_CODES_PER_DAY = 10;
    /** ... and guesses over all codes together. */
    public const int MAX_ATTEMPTS_PER_DAY = 20;
    public const int DAY = 86400;

    public function __construct(
        private EntityManagerInterface $em,
        private ClockInterface $clock,
        private PasswordHasherFactoryInterface $hasherFactory,
        #[Autowire(env: 'APP_SECRET')]
        private string $secret,
    ) {
    }

    /**
     * Invalidates the earlier codes of the user and creates a new one. Returns the plain code (only for the mail).
     */
    public function issueCode(User $user): string
    {
        $now = $this->clock->now();
        $this->em->createQueryBuilder()
            ->update(EmailVerification::class, 'ev')
            ->set('ev.invalidatedAt', ':now')
            ->where('ev.user = :user')
            ->andWhere('ev.invalidatedAt IS NULL')
            ->andWhere('ev.usedAt IS NULL')
            ->setParameter('now', $now, Types::DATETIME_IMMUTABLE)
            ->setParameter('user', $user)
            ->getQuery()
            ->execute();

        $code = str_pad((string) random_int(0, 999999), 6, '0', \STR_PAD_LEFT);
        $ev = new EmailVerification($now);
        $ev->setUser($user);
        $ev->setTokenHash($this->hasher()->hash($this->pepper($ev->getId(), $code)));
        $this->em->persist($ev);
        $this->em->flush();

        return $code;
    }

    /**
     * When the daily caps of the account (codes issued, guesses made) lift, null when it is not locked: the
     * moment the oldest code of the window is 24 hours old.
     */
    public function lockedUntil(User $user): ?\DateTimeImmutable
    {
        $since = $this->clock->now()->modify('-'.self::DAY.' seconds');
        $row = $this->em->createQueryBuilder()
            ->select('COUNT(ev.id) AS codes', 'COALESCE(SUM(ev.attempts), 0) AS attempts', 'MIN(ev.createdAt) AS oldest')
            ->from(EmailVerification::class, 'ev')
            ->where('ev.user = :user')
            ->andWhere('ev.createdAt > :since')
            ->setParameter('user', $user)
            ->setParameter('since', $since, Types::DATETIME_IMMUTABLE)
            ->getQuery()
            ->getSingleResult();
        if ((int) $row['codes'] < self::MAX_CODES_PER_DAY && (int) $row['attempts'] < self::MAX_ATTEMPTS_PER_DAY) {
            return null;
        }

        return (new \DateTimeImmutable((string) $row['oldest']))->modify('+'.self::DAY.' seconds');
    }

    /** Whether a code is waiting that can still be entered. */
    public function hasActiveCode(User $user): bool
    {
        return null !== $this->activeCode($user);
    }

    /**
     * When the next code mail to this account is allowed; null when allowed now. Counts the send time of the
     * last code, whether or not it is still valid.
     */
    public function nextSendAt(User $user): ?\DateTimeImmutable
    {
        $last = $this->em->createQueryBuilder()
            ->select('MAX(ev.createdAt)')
            ->from(EmailVerification::class, 'ev')
            ->where('ev.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->getSingleScalarResult();
        if (null === $last) {
            return null;
        }
        $next = (new \DateTimeImmutable((string) $last))->modify('+'.self::RESEND_COOLDOWN.' seconds');

        return $next > $this->clock->now() ? $next : null;
    }

    /**
     * Checks the code of the address and marks the user verified. Sessions issued earlier end, including
     * the restricted session of the caller (the controller issues a new one).
     *
     * @throws ApiProblemException 422 invalid_verification_code for every kind of failure
     */
    public function verify(User $user, string $code): void
    {
        $ev = !$user->isEmailVerified() && null === $this->lockedUntil($user) ? $this->activeCode($user) : null;
        $code = (string) preg_replace('/\s+/', '', $code);
        if (null === $ev) {
            $this->hasher()->hash($this->pepper('0', $code)); // similar work whether or not a code is waiting
            throw self::invalid();
        }

        // Every guess counts, atomically and before the comparison.
        if (1 !== $this->countAttempt($ev)) {
            throw self::invalid();
        }
        $this->em->refresh($ev);
        if (!$this->hasher()->verify($ev->getTokenHash(), $this->pepper($ev->getId(), $code))) {
            if ($ev->getAttempts() >= self::MAX_ATTEMPTS) {
                $this->close($ev, 'invalidatedAt');
            }
            throw self::invalid();
        }
        if (1 !== $this->close($ev, 'usedAt')) {
            throw self::invalid();
        }

        $this->revokeUnprovenAccess($user);
        $user->setIsEmailVerified(true);
        $user->invalidateTokens();
        $this->em->flush();
    }

    /**
     * An unconfirmed account cannot sign in any more, so passkeys or SSO links of such an account (data from
     * before this rule) were set up in sessions of someone who did not prove the address: they go, the
     * sessions end. Exception: a passwordless account created by an SSO login keeps its single provider link,
     * the mailbox owner's code is what lets that provider account in. An account with a password comes from
     * a local registration, so SSO links on it are removed.
     */
    private function revokeUnprovenAccess(User $user): void
    {
        if ($user->hasPasswordCredential()) {
            foreach ($user->getOauthAccounts()->toArray() as $account) {
                $user->getOauthAccounts()->removeElement($account);
                $this->em->remove($account);
            }
        }
        foreach ($user->getPasskeys()->toArray() as $passkey) {
            $user->getPasskeys()->removeElement($passkey);
            $this->em->remove($passkey);
        }
    }

    private function activeCode(User $user): ?EmailVerification
    {
        return $this->em->createQueryBuilder()
            ->select('ev')
            ->from(EmailVerification::class, 'ev')
            ->where('ev.user = :user')
            ->andWhere('ev.usedAt IS NULL')
            ->andWhere('ev.invalidatedAt IS NULL')
            ->andWhere('ev.expiresAt > :now')
            ->andWhere('ev.attempts < :max')
            ->setParameter('user', $user)
            ->setParameter('now', $this->clock->now(), Types::DATETIME_IMMUTABLE)
            ->setParameter('max', self::MAX_ATTEMPTS)
            ->orderBy('ev.createdAt', 'DESC')
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /** @return int 0 when the code is no longer open (used, invalidated, expired, used up) */
    private function countAttempt(EmailVerification $ev): int
    {
        return (int) $this->em->createQueryBuilder()
            ->update(EmailVerification::class, 'ev')
            ->set('ev.attempts', 'ev.attempts + 1')
            ->where('ev.id = :id')
            ->andWhere('ev.usedAt IS NULL')
            ->andWhere('ev.invalidatedAt IS NULL')
            ->andWhere('ev.expiresAt > :now')
            ->andWhere('ev.attempts < :max')
            ->setParameter('id', $ev->getId())
            ->setParameter('now', $this->clock->now(), Types::DATETIME_IMMUTABLE)
            ->setParameter('max', self::MAX_ATTEMPTS)
            ->getQuery()
            ->execute();
    }

    /** Marks the code used (`$field` usedAt) or invalidated; 0 when it already was either. */
    private function close(EmailVerification $ev, string $field): int
    {
        return (int) $this->em->createQueryBuilder()
            ->update(EmailVerification::class, 'ev')
            ->set('ev.'.$field, ':now')
            ->where('ev.id = :id')
            ->andWhere('ev.usedAt IS NULL')
            ->andWhere('ev.invalidatedAt IS NULL')
            ->setParameter('id', $ev->getId())
            ->setParameter('now', $this->clock->now(), Types::DATETIME_IMMUTABLE)
            ->getQuery()
            ->execute();
    }

    private function hasher(): PasswordHasherInterface
    {
        return $this->hasherFactory->getPasswordHasher('verification_code');
    }

    /** Hasher input: 64 hex characters (within bcrypt's 72 bytes), bound to the row. */
    private function pepper(string $id, string $code): string
    {
        return hash_hmac('sha256', $id."\0".$code, $this->secret);
    }

    private static function invalid(): ApiProblemException
    {
        return new ApiProblemException(422, 'The code is wrong or expired', 'invalid_verification_code', 'code');
    }
}
