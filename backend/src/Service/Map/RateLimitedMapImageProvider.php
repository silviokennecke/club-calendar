<?php
declare(strict_types=1);

namespace App\Service\Map;

use App\Exception\RateLimitExceededException;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

readonly class RateLimitedMapImageProvider implements MapImageProviderInterface
{
    public function __construct(
        private MapImageProviderInterface $inner,
        private RateLimiterFactoryInterface $mapboxImageSystemLimiter,
    ) {}

    public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string
    {
        $limiter = $this->mapboxImageSystemLimiter->create('image-system');
        if (!$limiter->consume()->isAccepted()) {
            throw new RateLimitExceededException('Map image rate limit exceeded');
        }

        return $this->inner->getImage($lng, $lat, $zoom, $width, $height);
    }
}
