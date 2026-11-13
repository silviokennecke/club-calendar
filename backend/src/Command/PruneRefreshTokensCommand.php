<?php

declare(strict_types=1);

namespace App\Command;

use App\Repository\RefreshTokenRepository;
use Psr\Clock\ClockInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Deletes refresh token sessions (families) that are over: expired, whether revoked or not. */
#[AsCommand(name: 'app:prune-refresh-tokens', description: 'Delete expired refresh tokens and sessions')]
class PruneRefreshTokensCommand
{
    public function __construct(
        private readonly RefreshTokenRepository $refreshTokens,
        private readonly ClockInterface $clock,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $deleted = $this->refreshTokens->pruneEnded($this->clock->now());
        $io->success(sprintf('Deleted %d expired refresh token(s).', $deleted));

        return Command::SUCCESS;
    }
}
