<?php

declare(strict_types=1);

namespace App\Security\Secret;

use Doctrine\DBAL\Connection;

/**
 * Brings every encrypted column value under the current key (legacy plaintext and values of any ring key). Works on
 * raw rows: no entities, no listeners, so updated_at and content versions stay untouched.
 */
class SecretRotator
{
    private const int BATCH = 200;

    public function __construct(
        private readonly Connection $connection,
        private readonly SecretCipher $cipher,
    ) {
    }

    /**
     * @return list<array{column: string, scanned: int, rewritten: int, current: int, changedMeanwhile: int, failedIds: list<string>}>
     */
    public function rotate(bool $dryRun): array
    {
        return array_map(fn (EncryptedColumn $c) => $this->rotateColumn($c, $dryRun), EncryptedColumns::all());
    }

    /**
     * @return array{column: string, scanned: int, rewritten: int, current: int, changedMeanwhile: int, failedIds: list<string>}
     */
    private function rotateColumn(EncryptedColumn $c, bool $dryRun): array
    {
        $result = ['column' => $c->label(), 'scanned' => 0, 'rewritten' => 0, 'current' => 0, 'changedMeanwhile' => 0, 'failedIds' => []];
        $table = $this->connection->quoteSingleIdentifier($c->table);
        $col = $this->connection->quoteSingleIdentifier($c->column);
        $id = $this->connection->quoteSingleIdentifier($c->idColumn);
        $last = '';

        while (true) {
            $rows = $this->connection->fetchAllAssociative(
                "SELECT $id AS id, $col AS value FROM $table WHERE $id > ? AND $col IS NOT NULL ORDER BY $id LIMIT ".self::BATCH,
                [$last],
            );
            if ([] === $rows) {
                return $result;
            }
            $last = (string) end($rows)['id'];

            $updates = [];
            foreach ($rows as $row) {
                ++$result['scanned'];
                try {
                    $plain = $this->cipher->decrypt((string) $row['value'], $c->purpose);
                } catch (SecretCipherException) {
                    $result['failedIds'][] = (string) $row['id'];
                    continue;
                }
                if ($this->cipher->usesCurrentKey((string) $row['value'])) {
                    ++$result['current'];
                    continue;
                }
                $updates[] = [(string) $row['id'], (string) $row['value'], $plain];
            }

            if ($dryRun) {
                $result['rewritten'] += count($updates);
                continue;
            }
            $this->connection->transactional(function () use ($updates, $table, $col, $id, $c, &$result): void {
                foreach ($updates as [$rowId, $old, $plain]) {
                    $changed = $this->connection->executeStatement(
                        "UPDATE $table SET $col = ? WHERE $id = ? AND $col = ?",
                        [$this->cipher->encrypt($plain, $c->purpose), $rowId, $old],
                    );
                    if (1 === $changed) {
                        ++$result['rewritten'];
                    } else {
                        ++$result['changedMeanwhile'];
                    }
                }
            });
        }
    }
}
