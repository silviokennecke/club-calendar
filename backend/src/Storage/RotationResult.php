<?php

declare(strict_types=1);

namespace App\Storage;

final class RotationResult
{
    public int $checked = 0;
    public int $rotated = 0;
    public int $current = 0;
    public int $changedMeanwhile = 0;
    /** @var list<string> object keys no configured key can read */
    public array $unreadable = [];
    /** @var list<string> objects above the 5 GB single-copy limit that are not under the current key */
    public array $tooLarge = [];
    public ?string $skipped = null;

    public function failed(): bool
    {
        return [] !== $this->unreadable || [] !== $this->tooLarge;
    }
}
