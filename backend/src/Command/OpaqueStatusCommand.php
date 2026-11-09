<?php

declare(strict_types=1);

namespace App\Command;

use App\Opaque\OpaqueCutoff;
use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Migration progress (docs/ops/OPAQUE-PLAN.md 6.8): counts of accounts by password credential, no personal data. */
#[AsCommand(name: 'app:opaque:status', description: 'Show how many accounts use OPAQUE, legacy bcrypt or no password')]
class OpaqueStatusCommand
{
    public function __construct(
        private readonly Connection $connection,
        private readonly OpaqueCutoff $rollout,
    ) {
    }

    public function __invoke(SymfonyStyle $io, #[Option(description: 'Print JSON instead of a table')] bool $json = false): int
    {
        $row = $this->connection->fetchAssociative(
            'SELECT COUNT(*) AS total,'
            .' COALESCE(SUM(opaque_record IS NOT NULL), 0) AS with_record,'
            .' COALESCE(SUM(opaque_record IS NULL AND password IS NOT NULL), 0) AS bcrypt_only,'
            .' COALESCE(SUM(opaque_record IS NOT NULL AND password IS NOT NULL), 0) AS both_credentials,'
            .' COALESCE(SUM(opaque_record IS NULL AND password IS NULL), 0) AS no_password'
            .' FROM `user`',
        ) ?: [];
        /** @var array<string, int|string> $byKey */
        $byKey = $this->connection->fetchAllKeyValue('SELECT COALESCE(opaque_key_id, \'\'), COUNT(*) FROM `user` WHERE opaque_record IS NOT NULL GROUP BY opaque_key_id ORDER BY 1');
        $recordsByKeyId = [];
        foreach ($byKey as $id => $count) {
            $recordsByKeyId[(string) $id] = (int) $count;
        }
        $total = (int) ($row['total'] ?? 0);
        $withRecord = (int) ($row['with_record'] ?? 0);
        $bcryptOnly = (int) ($row['bcrypt_only'] ?? 0);
        $withPassword = $withRecord + $bcryptOnly;
        $migrated = 0 === $withPassword ? 0.0 : round(100 * $withRecord / $withPassword, 1);

        $data = [
            'legacyCutoff' => $this->rollout->cutoff()?->format('Y-m-d'),
            'total' => $total,
            'withRecord' => $withRecord,
            'bcryptOnly' => $bcryptOnly,
            'both' => (int) ($row['both_credentials'] ?? 0),
            'noPassword' => (int) ($row['no_password'] ?? 0),
            'migratedPercent' => $migrated,
            'recordsByKeyId' => (object) $recordsByKeyId,
        ];
        if ($json) {
            $io->writeln(json_encode($data, \JSON_THROW_ON_ERROR));

            return Command::SUCCESS;
        }

        $io->definitionList(
            ['OPAQUE_LEGACY_CUTOFF' => $data['legacyCutoff'] ?? '(none)'],
        );
        $io->table(['Accounts', 'Count'], [
            ['total', $total],
            ['with OPAQUE record', $withRecord],
            ['bcrypt only (legacy)', $bcryptOnly],
            ['both (upgraded, hash kept until phase 2)', $data['both']],
            ['no password (SSO/passkey only)', $data['noPassword']],
        ]);
        $io->table(['Key id', 'Records'], array_map(static fn (string $id, int $n): array => ['' === $id ? '(none)' : $id, $n], array_keys($recordsByKeyId), $recordsByKeyId));
        $io->writeln(sprintf('Migrated: %s %% of accounts with a password', $migrated));

        return Command::SUCCESS;
    }
}
