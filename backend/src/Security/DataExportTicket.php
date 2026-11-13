<?php

declare(strict_types=1);

namespace App\Security;

/** The budget slots taken by one data export attempt; {@see release()} refunds them when the export failed. */
final class DataExportTicket
{
    private bool $released = false;

    /** @param list<array{0: string, 1: string}> $slots purpose and key of each taken slot */
    public function __construct(private readonly NonceStore $nonces, private readonly array $slots)
    {
    }

    public function release(): void
    {
        if ($this->released) {
            return;
        }
        $this->released = true;
        foreach ($this->slots as [$purpose, $key]) {
            $this->nonces->forget($purpose, $key);
        }
    }
}
