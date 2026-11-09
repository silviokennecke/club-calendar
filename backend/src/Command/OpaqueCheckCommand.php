<?php

declare(strict_types=1);

namespace App\Command;

use App\Opaque\OpaqueCutoff;
use App\Opaque\OpaqueException;
use App\Opaque\OpaqueKeys;
use App\Opaque\OpaqueServer;
use Doctrine\DBAL\Connection;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** Fails (exit 1) on an invalid cutoff value or when any key set is missing or invalid (all ids, unique, active id present); used by docker/entrypoint.sh. */
#[AsCommand(name: 'app:opaque:check', description: 'Validate the OPAQUE configuration (fatal when invalid)')]
class OpaqueCheckCommand
{
    public function __construct(
        #[Autowire(env: 'OPAQUE_OPRF_SEED')]
        #[\SensitiveParameter]
        private readonly string $seed,
        #[Autowire(env: 'OPAQUE_SERVER_PRIVATE_KEY')]
        #[\SensitiveParameter]
        private readonly string $privateKey,
        #[Autowire(env: 'OPAQUE_KEYS')]
        #[\SensitiveParameter]
        private readonly string $keySets,
        #[Autowire(env: 'OPAQUE_ACTIVE_KEY_ID')]
        private readonly string $activeKeyId,
        private readonly Connection $connection,
        #[Autowire(env: 'OPAQUE_LEGACY_CUTOFF')]
        private readonly string $legacyCutoff,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        try {
            OpaqueCutoff::validate($this->legacyCutoff);
        } catch (OpaqueException $e) {
            $io->getErrorStyle()->error($e->getMessage());

            return Command::FAILURE;
        }
        try {
            $keys = new OpaqueKeys($this->seed, $this->privateKey, $this->keySets, $this->activeKeyId);
            foreach ($keys->ids() as $id) {
                OpaqueServer::fromKeys($keys, keyId: $id);
            }
        } catch (OpaqueException $e) {
            $io->getErrorStyle()->error($e->getMessage());

            return Command::FAILURE;
        }
        $io->writeln(sprintf('OPAQUE configuration valid, %d key set(s) valid (%s), active: %s.', count($keys->ids()), implode(', ', $keys->ids()), $keys->activeId()));
        $this->warnAboutKeyUsage($io, $keys);

        return Command::SUCCESS;
    }

    /** Warnings only (the database may be unreachable at container start): unreferenced keys, records under unknown ids. */
    private function warnAboutKeyUsage(SymfonyStyle $io, OpaqueKeys $keys): void
    {
        try {
            /** @var array<string, int|string> $counts */
            $counts = $this->connection->fetchAllKeyValue('SELECT opaque_key_id, COUNT(*) FROM `user` WHERE opaque_record IS NOT NULL GROUP BY opaque_key_id');
        } catch (\Throwable) {
            return;
        }
        $err = $io->getErrorStyle();
        foreach ($keys->ids() as $id) {
            if ($id !== $keys->activeId() && 0 === (int) ($counts[$id] ?? 0)) {
                $err->warning(sprintf('Key "%s" is configured but no record references it any more: it can be removed.', $id));
            }
        }
        foreach ($counts as $id => $count) {
            if (!$keys->has((string) $id)) {
                $err->warning(sprintf('%d record(s) reference key id "%s", which is not configured: those accounts need a password reset.', (int) $count, '' === (string) $id ? '(none)' : $id));
            }
        }
    }
}
