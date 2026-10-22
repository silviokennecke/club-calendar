<?php

declare(strict_types=1);

namespace App\OAuth;

use App\Entity\McpGrant;
use App\Entity\User;

final readonly class ResolvedAccessToken
{
    /** @param list<McpScope> $scopes */
    public function __construct(public User $user, public McpGrant $grant, public array $scopes)
    {
    }

    public function allows(McpScope $scope): bool
    {
        return McpScope::allows($this->scopes, $scope);
    }
}
