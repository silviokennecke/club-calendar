<?php

declare(strict_types=1);

namespace App\Command;

use App\Security\NonceStore;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Cron: deletes expired one-time values (the nonce store no longer sweeps them while consuming). */
#[AsCommand(name: 'app:prune-auth-nonces', description: 'Delete expired one-time sign-in values')]
class PruneAuthNoncesCommand
{
    public function __construct(private readonly NonceStore $nonces)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $io->success(sprintf('Deleted %d expired value(s).', $this->nonces->prune()));

        return Command::SUCCESS;
    }
}
