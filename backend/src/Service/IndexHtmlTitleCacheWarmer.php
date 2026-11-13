<?php

declare(strict_types=1);

namespace App\Service;

use Psr\Log\LoggerInterface;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;

/** Sets the SPA title from APP_NAME on cache:clear / cache:warmup. Optional; never fails the warmup. */
class IndexHtmlTitleCacheWarmer implements CacheWarmerInterface
{
    public function __construct(
        private readonly IndexHtmlTitle $title,
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
            if ($this->title->templateExists()) {
                $this->title->apply();
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Page title was not set from APP_NAME: '.$e->getMessage());
        }

        return [];
    }
}
