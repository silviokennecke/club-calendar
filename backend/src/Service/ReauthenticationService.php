<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Proof of the step-up confirmation (`StepUpService`). An account with a password proves it with that password.
 * An account without one (SSO-only, passkey-only) proves it with a 6-digit code mailed to its address on
 * request: the code is random, only its keyed hash is stored (`step_up_code`, one row per user, a new code
 * replaces the old one), it is valid 10 minutes and single use. A code that was never sent cannot match. The
 * caller checks it under the user row lock and consumes it only when the whole confirmation succeeded; failed
 * attempts are counted by `StepUpProofBudget`.
 */
readonly class ReauthenticationService
{
    public const int CODE_TTL = 600;

    public function __construct(
        private UserPasswordHasherInterface $hasher,
        private AccountMailer $mailer,
        private ClockInterface $clock,
        private Connection $connection,
        #[Autowire(env: 'APP_SECRET')]
        private string $secret,
    ) {
    }

    /** Stores a fresh code (replacing any earlier one, which dies) and mails it. */
    public function sendCode(User $user): void
    {
        if (null !== $user->getPassword()) {
            throw new ApiProblemException(409, 'This account has a password: confirm with it', 'has_password');
        }
        $code = str_pad((string) random_int(0, 999_999), 6, '0', \STR_PAD_LEFT);
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        $this->connection->executeStatement(
            'INSERT INTO step_up_code (id, user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE id = VALUES(id), code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), created_at = VALUES(created_at)',
            [
                Uuid::v7()->toRfc4122(),
                $user->getId(),
                $this->hash($user, $code),
                $now->modify('+'.self::CODE_TTL.' seconds')->format('Y-m-d H:i:s'),
                $now->format('Y-m-d H:i:s'),
            ],
        );
        $this->mailer->sendStepUpCode($user, $code, intdiv(self::CODE_TTL, 60));
    }

    public function passwordMatches(User $user, ?string $password): bool
    {
        return null !== $password && '' !== $password && $this->hasher->isPasswordValid($user, $password);
    }

    /** Whether `$code` is the user's sent, unused, unexpired code. Does not consume it. */
    public function codeMatches(User $user, ?string $code): bool
    {
        return false !== $this->connection->fetchOne(
            'SELECT 1 FROM step_up_code WHERE user_id = ? AND code_hash = ? AND expires_at > ?',
            [$user->getId(), $this->hash($user, trim((string) $code)), $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s')],
        );
    }

    /** Spends the user's code (after a successful confirmation). */
    public function consumeCode(User $user): void
    {
        $this->connection->executeStatement('DELETE FROM step_up_code WHERE user_id = ?', [$user->getId()]);
    }

    private function hash(User $user, string $code): string
    {
        $key = hash_hmac('sha256', 'step-up-code', $this->secret, true);

        return hash_hmac('sha256', $user->getId().'|'.$code, $key);
    }
}
