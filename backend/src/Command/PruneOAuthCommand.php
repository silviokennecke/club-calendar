<?php

declare(strict_types=1);

namespace App\Command;

use App\Repository\McpGrantRepository;
use App\Repository\McpTokenRepository;
use App\Repository\OAuthAuthorizationCodeRepository;
use App\Repository\OAuthAuthorizationRequestRepository;
use App\Repository\OAuthClientRepository;
use Psr\Clock\ClockInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Cron: deletes expired authorization requests, codes and tokens, grants that ended more than a day ago and
 * clients without any grant registered more than 30 days ago.
 */
#[AsCommand(name: 'app:prune-oauth', description: 'Delete expired OAuth/MCP requests, codes, tokens, grants and unused clients')]
class PruneOAuthCommand
{
    private const string TOKEN_MARGIN = '-1 day';
    private const string CLIENT_AGE = '-30 days';

    public function __construct(
        private readonly OAuthAuthorizationRequestRepository $requests,
        private readonly OAuthAuthorizationCodeRepository $codes,
        private readonly McpTokenRepository $tokens,
        private readonly McpGrantRepository $grants,
        private readonly OAuthClientRepository $clients,
        private readonly ClockInterface $clock,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $now = $this->clock->now();
        $margin = $now->modify(self::TOKEN_MARGIN);

        $io->success(sprintf(
            'Deleted %d request(s), %d code(s), %d token(s), %d grant(s), %d client(s).',
            $this->requests->pruneExpired($now),
            $this->codes->pruneExpired($now),
            $this->tokens->pruneExpired($margin),
            $this->grants->pruneEnded($margin),
            $this->clients->pruneUnused($now->modify(self::CLIENT_AGE)),
        ));

        return Command::SUCCESS;
    }
}
