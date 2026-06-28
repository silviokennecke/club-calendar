<?php

declare(strict_types=1);

namespace App\Service\Map;

use Symfony\Bundle\SecurityBundle\Security;

readonly class RequestUserContext
{
    public function __construct(private readonly Security $security)
    {
    }

    public function getUserIdentifier(): string
    {
        return $this->security->getUser()?->getUserIdentifier() ?? 'anonymous';
    }
}
