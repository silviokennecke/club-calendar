<?php

declare(strict_types=1);

namespace App\Security;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\DBAL\ParameterType;
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

    /**
     * Single insert-or-fail. Expired rows are not swept here (a sweep inside a caller's transaction locks
     * unrelated rows); `app:prune-auth-nonces` does that. Only an expired row with the very same hash is
     * replaced, so a reused key (slot, mail interval) becomes available again at its expiry.
     */
    public function consume(string $purpose, string $nonce, int $expiresAtTimestamp): bool
    {
        $hash = hash('sha256', $purpose."\0".$nonce);
        for ($attempt = 0; $attempt < 2; ++$attempt) {
            try {
                $this->connection->insert('auth_nonce', [
                    'id' => Uuid::v7()->toRfc4122(),
                    'nonce_hash' => $hash,
                    // Keep the entry a little past the token expiry so clock skew cannot reopen it.
                    'expires_at' => (new \DateTimeImmutable('@'.($expiresAtTimestamp + 60)))->format('Y-m-d H:i:s'),
                ]);

                return true;
            } catch (UniqueConstraintViolationException) {
                // Both sides in UTC: expires_at is written from a Unix timestamp.
                $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
                $replaced = $this->connection->executeStatement(
                    'DELETE FROM auth_nonce WHERE nonce_hash = ? AND expires_at < ?',
                    [$hash, $now->format('Y-m-d H:i:s')],
                );
                if (0 === $replaced) {
                    return false;
                }
            }
        }

        return false;
    }

    /**
     * Unix expiry timestamps (including the 60 s padding) of the still live entries among the given values.
     *
     * @param list<string> $nonces
     *
     * @return list<int>
     */
    public function liveExpiries(string $purpose, array $nonces): array
    {
        $hashes = array_map(static fn (string $n): string => hash('sha256', $purpose."\0".$n), $nonces);
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        $rows = $this->connection->fetchFirstColumn(
            'SELECT expires_at FROM auth_nonce WHERE nonce_hash IN (?) AND expires_at >= ?',
            [$hashes, $now->format('Y-m-d H:i:s')],
            [ArrayParameterType::STRING, ParameterType::STRING],
        );

        return array_map(static fn (string $d): int => (new \DateTimeImmutable($d, new \DateTimeZone('UTC')))->getTimestamp(), $rows);
    }

    /** Deletes expired entries in small batches (autocommit); returns the number deleted. */
    public function prune(int $batch = 1000): int
    {
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $total = 0;
        do {
            $n = (int) $this->connection->executeStatement(
                sprintf('DELETE FROM auth_nonce WHERE expires_at < ? LIMIT %d', $batch),
                [$now],
            );
            $total += $n;
        } while ($n >= $batch);

        return $total;
    }
}
