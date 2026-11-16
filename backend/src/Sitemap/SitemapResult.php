<?php

declare(strict_types=1);

namespace App\Sitemap;

final readonly class SitemapResult
{
    /** @param list<string> $files part file names (without directory), in order */
    public function __construct(
        public array $files,
        public int $urlCount,
        public int $feedCount,
    ) {
    }
}
