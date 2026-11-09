<?php

declare(strict_types=1);

namespace App\Command;

use App\Opaque\OpaqueException;
use App\Opaque\OpaqueKeys;
use App\Opaque\OpaqueRollout;
use App\Opaque\OpaqueServer;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** Fails (exit 1) on an invalid rollout/cutoff value, or when OPAQUE_ENABLED is true and the keys are missing or invalid; used by docker/entrypoint.sh. */
#[AsCommand(name: 'app:opaque:check', description: 'Validate the OPAQUE configuration (fatal when enabled and invalid)')]
class OpaqueCheckCommand
{
    public function __construct(
        #[Autowire(env: 'bool:OPAQUE_ENABLED')]
        private readonly bool $enabled,
        #[Autowire(env: 'OPAQUE_OPRF_SEED')]
        #[\SensitiveParameter]
        private readonly string $seed,
        #[Autowire(env: 'OPAQUE_SERVER_PRIVATE_KEY')]
        #[\SensitiveParameter]
        private readonly string $privateKey,
        #[Autowire(env: 'OPAQUE_ROLLOUT_PERCENT')]
        private readonly string $rolloutPercent,
        #[Autowire(env: 'OPAQUE_LEGACY_CUTOFF')]
        private readonly string $legacyCutoff,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        try {
            OpaqueRollout::validate($this->rolloutPercent, $this->legacyCutoff);
        } catch (OpaqueException $e) {
            $io->getErrorStyle()->error($e->getMessage());

            return Command::FAILURE;
        }
        if (!$this->enabled) {
            $io->writeln('OPAQUE disabled (OPAQUE_ENABLED is false): keys are not checked.');

            return Command::SUCCESS;
        }
        try {
            OpaqueServer::fromKeys(new OpaqueKeys(true, $this->seed, $this->privateKey));
        } catch (OpaqueException $e) {
            $io->getErrorStyle()->error($e->getMessage());

            return Command::FAILURE;
        }
        $io->writeln('OPAQUE enabled, keys valid.');

        return Command::SUCCESS;
    }
}
