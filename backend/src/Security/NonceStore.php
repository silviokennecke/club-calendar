<?php

declare(strict_types=1);

namespace App\Security;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Psr\Clock\ClockInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Remembers consumed one-time values until they expire. consume() returns false when the value was
 * used before, so a challenge or OAuth state can be accepted only once, also across processes.
 */
final readonly class NonceStore
{
    public function __construct(
        private Connection $connection,
        private ClockInterface $clock,
    ) {
    }

    /** True when the value was consumed before (and the entry has not been purged yet); does not consume. */
    public function isConsumed(string $purpose, string $nonce): bool
    {
        return false !== $this->connection->fetchOne(
            'SELECT 1 FROM auth_nonce WHERE nonce_hash = ?',
            [hash('sha256', $purpose."\0".$nonce)],
        );
    }

    public function consume(string $purpose, string $nonce, int $expiresAtTimestamp): bool
    {
        // Both sides in UTC: expires_at is written from a Unix timestamp, so comparing against the clock's
        // local time would purge consumed entries early (and reopen replays) on a non-UTC server.
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        $this->connection->executeStatement(
            'DELETE FROM auth_nonce WHERE expires_at < ?',
            [$now->format('Y-m-d H:i:s')],
        );

        try {
            $this->connection->insert('auth_nonce', [
                'id' => Uuid::v7()->toRfc4122(),
                'nonce_hash' => hash('sha256', $purpose."\0".$nonce),
                // Keep the entry a little past the token expiry so clock skew cannot reopen it.
                'expires_at' => (new \DateTimeImmutable('@'.($expiresAtTimestamp + 60)))->format('Y-m-d H:i:s'),
            ]);
        } catch (UniqueConstraintViolationException) {
            return false;
        }

        return true;
    }
}
