<?php

declare(strict_types=1);

namespace App\Command;

use App\Opaque\OpaqueRollout;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Phase 2 (docs/ops/OPAQUE-PLAN.md 6.5, 6.8): deletes every remaining bcrypt hash after the cutoff. Accounts with an
 * OPAQUE record lose only the kept hash; accounts without one must reset their password. Sessions stay valid.
 * Dry run unless --force; refuses before the cutoff and while OPAQUE is off.
 */
#[AsCommand(name: 'app:opaque:retire-legacy', description: 'After the cutoff: delete all remaining bcrypt password hashes (dry run unless --force)')]
class OpaqueRetireLegacyCommand
{
    public function __construct(
        private readonly Connection $connection,
        private readonly OpaqueRollout $rollout,
        private readonly ClockInterface $clock,
    ) {
    }

    public function __invoke(SymfonyStyle $io, #[Option(description: 'Actually delete the hashes (default: only count)')] bool $force = false): int
    {
        $cutoff = $this->rollout->cutoff();
        if (!$this->rollout->isEnabled()) {
            $io->error('OPAQUE_ENABLED is off. Refusing.');

            return Command::FAILURE;
        }
        if (null === $cutoff || !$this->rollout->cutoffReached($this->clock->now())) {
            $io->error('The OPAQUE_LEGACY_CUTOFF date is not set or not reached yet. Refusing.');

            return Command::FAILURE;
        }

        $row = $this->connection->fetchAssociative(
            'SELECT COALESCE(SUM(opaque_record IS NULL), 0) AS must_reset, COALESCE(SUM(opaque_record IS NOT NULL), 0) AS cleanup'
            .' FROM `user` WHERE password IS NOT NULL',
        ) ?: [];
        $mustReset = (int) ($row['must_reset'] ?? 0);
        $cleanup = (int) ($row['cleanup'] ?? 0);
        $io->table(['Hashes to delete', 'Count'], [
            ['accounts without OPAQUE record (must reset the password)', $mustReset],
            ['accounts with OPAQUE record (leftover hash)', $cleanup],
        ]);
        if (!$force) {
            $io->note('Dry run. Re-run with --force to delete the hashes.');

            return Command::SUCCESS;
        }

        $deleted = $this->connection->executeStatement('UPDATE `user` SET password = NULL WHERE password IS NOT NULL');
        $io->success(sprintf('Deleted %d bcrypt hash(es).', $deleted));

        return Command::SUCCESS;
    }
}
