<?php

declare(strict_types=1);

namespace App\Service;

use App\Repository\McpGrantRepository;
use App\Repository\McpTokenRepository;
use App\Repository\OAuthAuthorizationCodeRepository;
use App\Repository\OAuthAuthorizationRequestRepository;
use App\Repository\OAuthClientRepository;
use Psr\Clock\ClockInterface;

/**
 * Deletes expired authorization requests, codes and tokens, grants that ended more than a day ago and
 * clients without any grant registered more than 30 days ago.
 */
class OAuthPruner
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

    /** @return array{requests: int, codes: int, tokens: int, grants: int, clients: int} */
    public function prune(): array
    {
        $now = $this->clock->now();
        $margin = $now->modify(self::TOKEN_MARGIN);

        return [
            'requests' => $this->requests->pruneExpired($now),
            'codes' => $this->codes->pruneExpired($now),
            'tokens' => $this->tokens->pruneExpired($margin),
            'grants' => $this->grants->pruneEnded($margin),
            'clients' => $this->clients->pruneUnused($now->modify(self::CLIENT_AGE)),
        ];
    }
}
