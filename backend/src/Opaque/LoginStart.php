<?php

declare(strict_types=1);

namespace App\Opaque;

final readonly class LoginStart
{
    public function __construct(public string $ke2, public ServerLoginState $state)
    {
    }
}
