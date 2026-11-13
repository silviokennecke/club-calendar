<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\OAuthPruner;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Deletes expired authorization requests, codes and tokens, grants that ended more than a day ago and
 * clients without any grant registered more than 30 days ago.
 */
#[AsCommand(name: 'app:prune-oauth', description: 'Delete expired OAuth/MCP requests, codes, tokens, grants and unused clients')]
class PruneOAuthCommand
{
    public function __construct(private readonly OAuthPruner $pruner)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $n = $this->pruner->prune();
        $io->success(sprintf(
            'Deleted %d request(s), %d code(s), %d token(s), %d grant(s), %d client(s).',
            $n['requests'],
            $n['codes'],
            $n['tokens'],
            $n['grants'],
            $n['clients'],
        ));

        return Command::SUCCESS;
    }
}
