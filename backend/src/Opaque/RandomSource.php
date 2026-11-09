<?php

declare(strict_types=1);

namespace App\Opaque;

/** Injectable randomness (nonces, key share seeds, fake masking keys); production uses {@see SystemRandom}. */
interface RandomSource
{
    public function bytes(int $length): string;
}
