<?php

declare(strict_types=1);

namespace App\Opaque;

final class SystemRandom implements RandomSource
{
    public function bytes(int $length): string
    {
        return random_bytes($length);
    }
}
