<?php

declare(strict_types=1);

namespace App\Security;

use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
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
     * One atomic `INSERT ... ON DUPLICATE KEY UPDATE`: a free key is inserted, an expired row with the very same
     * hash is renewed in place (a reused key such as a slot or mail interval opens again at its expiry), a live
     * row stays untouched. There is no separate DELETE, so concurrent consumers (also inside transactions)
     * cannot deadlock on a lock-order inversion; the duplicate path takes an exclusive lock directly. Expired
     * rows are not swept here (`app:prune-auth-nonces` does that). The winner is read from the affected rows
     * (pdo_mysql without FOUND_ROWS: 1 inserted, 2 renewed, 0 live row unchanged).
     */
    public function consume(string $purpose, string $nonce, int $expiresAtTimestamp): bool
    {
        // Both sides in UTC: expires_at is written from a Unix timestamp.
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        // Keep the entry a little past the token expiry so clock skew cannot reopen it.
        $expires = (new \DateTimeImmutable('@'.($expiresAtTimestamp + 60)))->format('Y-m-d H:i:s');

        $affected = (int) $this->connection->executeStatement(
            'INSERT INTO auth_nonce (id, nonce_hash, expires_at) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = IF(expires_at < ?, ?, expires_at)',
            [Uuid::v7()->toRfc4122(), hash('sha256', $purpose."\0".$nonce), $expires, $now, $expires],
        );

        return $affected > 0;
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
