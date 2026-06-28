<?php

declare(strict_types=1);

namespace App\Service\Map;

use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

readonly class CachingMapImageProvider implements MapImageProviderInterface
{
    public function __construct(
        private MapImageProviderInterface $inner,
        private CacheInterface $mapImagesCache,
    ) {
    }

    public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string
    {
        $key = MapCacheKeyHelper::forMapImage($lng, $lat, $zoom, $width, $height);

        return $this->mapImagesCache->get($key, function (ItemInterface $item) use ($lng, $lat, $zoom, $width, $height): string {
            return $this->inner->getImage($lng, $lat, $zoom, $width, $height);
        });
    }
}
