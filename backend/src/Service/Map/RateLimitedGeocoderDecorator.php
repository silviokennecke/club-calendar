<?php
declare(strict_types=1);

namespace App\Service\Map;

use App\Exception\RateLimitExceededException;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

readonly class RateLimitedGeocoderDecorator implements GeocoderInterface
{
    public function __construct(
        private GeocoderInterface $inner,
        private RateLimiterFactoryInterface $geocoderDailyLimiter,
        private RateLimiterFactoryInterface $geocoderHourlyLimiter,
        private RequestUserContext $userContext,
    ) {}

    public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
    {
        $this->consume();
        return $this->inner->suggest($query, $proximityLat, $proximityLng, $limit);
    }

    public function reverse(float $lng, float $lat): ?GeocodedAddress
    {
        $this->consume();
        return $this->inner->reverse($lng, $lat);
    }

    private function consume(): void
    {
        $daily = $this->geocoderDailyLimiter->create('geocoder-system');
        if (!$daily->consume()->isAccepted()) {
            throw new RateLimitExceededException('Geocoder daily rate limit exceeded');
        }

        $hourly = $this->geocoderHourlyLimiter->create($this->userContext->getUserIdentifier());
        if (!$hourly->consume()->isAccepted()) {
            throw new RateLimitExceededException('Geocoder hourly rate limit exceeded');
        }
    }
}
