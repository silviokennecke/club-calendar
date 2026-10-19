<?php

declare(strict_types=1);

namespace App\Service;

use Psr\Log\LoggerInterface;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;

/** Syncs the legal documents on cache:clear / cache:warmup. Optional; never fails the warmup. */
class LegalDocumentCacheWarmer implements CacheWarmerInterface
{
    public function __construct(
        private readonly LegalDocumentService $legal,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function isOptional(): bool
    {
        return true;
    }

    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        try {
            $this->legal->sync();
        } catch (\Throwable $e) {
            $this->logger->warning('Legal documents were not synchronised: '.$e->getMessage());
        }

        return [];
    }
}
