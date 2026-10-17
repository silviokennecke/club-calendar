<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\RefreshToken;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Doctrine\Persistence\ManagerRegistry;

/**
 * Writes go through single conditional UPDATEs / DELETEs on the connection, so concurrent requests
 * never both win (no read-modify-write on loaded entities).
 *
 * @extends ServiceEntityRepository<RefreshToken>
 */
class RefreshTokenRepository extends ServiceEntityRepository
{
    private const string FORMAT = 'Y-m-d H:i:s';

    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, RefreshToken::class);
    }

    /** Inserts the row directly (no unit of work: the user entity may belong to another entity manager). */
    public function store(RefreshToken $token): void
    {
        $this->connection()->insert('refresh_token', [
            'id' => $token->getId(),
            'family_id' => $token->getFamilyId(),
            'user_id' => $token->getUser()->getId(),
            'issued_at' => $this->utc($token->getIssuedAt()),
            'expires_at' => $this->utc($token->getExpiresAt()),
            'family_expires_at' => $this->utc($token->getFamilyExpiresAt()),
        ]);
    }

    /**
     * Current state straight from the database (no identity map: a concurrent request may have changed it).
     *
     * @return array{user_id: string, family_id: string, expires_at: \DateTimeImmutable, family_expires_at: \DateTimeImmutable, rotated_at: ?\DateTimeImmutable, revoked_at: ?\DateTimeImmutable}|null
     */
    public function findState(string $id): ?array
    {
        $row = $this->connection()->fetchAssociative(
            'SELECT user_id, family_id, expires_at, family_expires_at, rotated_at, revoked_at FROM refresh_token WHERE id = ?',
            [$id],
        );
        if (false === $row) {
            return null;
        }
        $utc = new \DateTimeZone('UTC');
        $time = static fn (?string $v): ?\DateTimeImmutable => null === $v ? null : new \DateTimeImmutable($v, $utc);

        return [
            'user_id' => (string) $row['user_id'],
            'family_id' => (string) $row['family_id'],
            'expires_at' => new \DateTimeImmutable((string) $row['expires_at'], $utc),
            'family_expires_at' => new \DateTimeImmutable((string) $row['family_expires_at'], $utc),
            'rotated_at' => $time($row['rotated_at']),
            'revoked_at' => $time($row['revoked_at']),
        ];
    }

    /** Marks a token as used. True for exactly one of any number of concurrent calls. */
    public function markRotated(string $id, \DateTimeImmutable $now): bool
    {
        return 1 === $this->connection()->executeStatement(
            'UPDATE refresh_token SET rotated_at = ? WHERE id = ? AND rotated_at IS NULL AND revoked_at IS NULL',
            [$this->utc($now), $id],
        );
    }

    /** Revokes every open token of the session; returns the number of rows changed. */
    public function revokeFamily(string $familyId, \DateTimeImmutable $now): int
    {
        return (int) $this->connection()->executeStatement(
            'UPDATE refresh_token SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
            [$this->utc($now), $familyId],
        );
    }

    public function revokeAllOfUser(string $userId, \DateTimeImmutable $now): int
    {
        return (int) $this->connection()->executeStatement(
            'UPDATE refresh_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
            [$this->utc($now), $userId],
        );
    }

    /**
     * Deletes whole sessions that are over: the newest token of the family has expired or the family's absolute
     * end has passed (revoked families stay until then, so a presented revoked token is still recognised).
     * Returns the number of rows deleted.
     */
    public function pruneEnded(\DateTimeImmutable $now): int
    {
        $ts = $this->utc($now);

        return (int) $this->connection()->executeStatement(
            'DELETE FROM refresh_token WHERE family_id IN (
                SELECT family_id FROM (
                    SELECT family_id FROM refresh_token GROUP BY family_id
                    HAVING MAX(expires_at) < ? OR MIN(family_expires_at) < ?
                ) ended
            )',
            [$ts, $ts],
            [ParameterType::STRING, ParameterType::STRING],
        );
    }

    private function connection(): Connection
    {
        return $this->getEntityManager()->getConnection();
    }

    private function utc(\DateTimeImmutable $time): string
    {
        return $time->setTimezone(new \DateTimeZone('UTC'))->format(self::FORMAT);
    }
}
