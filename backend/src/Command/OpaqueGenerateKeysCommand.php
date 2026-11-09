<?php

declare(strict_types=1);

namespace App\Command;

use App\Opaque\OpaqueKeys;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Prints fresh OPAQUE secrets as an env snippet. Writes nothing: the operator stores them (and backs them up). */
#[AsCommand(name: 'app:opaque:generate-keys', description: 'Print new OPAQUE_OPRF_SEED and OPAQUE_SERVER_PRIVATE_KEY values')]
class OpaqueGenerateKeysCommand
{
    public function __invoke(SymfonyStyle $io): int
    {
        $seed = random_bytes(OpaqueKeys::SEED_LENGTH);
        $private = sodium_crypto_core_ristretto255_scalar_random();

        $io->writeln('OPAQUE_OPRF_SEED='.OpaqueKeys::encode($seed));
        $io->writeln('OPAQUE_SERVER_PRIVATE_KEY='.OpaqueKeys::encode($private));
        $io->getErrorStyle()->warning('Store these values permanently and back them up. Losing them invalidates every OPAQUE password record.');

        sodium_memzero($seed);
        sodium_memzero($private);

        return Command::SUCCESS;
    }
}
