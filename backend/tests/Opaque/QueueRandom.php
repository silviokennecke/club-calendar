<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\RandomSource;

/** Returns the queued byte strings in order, then falls back to the CSPRNG. */
final class QueueRandom implements RandomSource
{
    /** @param list<string> $queue */
    public function __construct(private array $queue = [])
    {
    }

    public function bytes(int $length): string
    {
        $next = array_shift($this->queue);
        if (null === $next) {
            return random_bytes($length);
        }
        if (strlen($next) !== $length) {
            throw new \LogicException('Queued value has the wrong length.');
        }

        return $next;
    }
}
