<?php

declare(strict_types=1);

namespace App\Service\Map;

use App\Exception\RateLimitExceededException;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

readonly class RateLimitedGeocoderDecorator implements GeocoderInterface
{
    public function __construct(
        private GeocoderInterface $inner,
        private RateLimiterFactoryInterface $geocoderSystemLimiter,
        private RateLimiterFactoryInterface $geocoderUserLimiter,
        private RequestUserContext $userContext,
    ) {
    }

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
        $system = $this->geocoderSystemLimiter->create('geocoder-system');
        if (!$system->consume()->isAccepted()) {
            throw new RateLimitExceededException('Geocoder system rate limit exceeded');
        }

        $user = $this->geocoderUserLimiter->create($this->userContext->getUserIdentifier());
        if (!$user->consume()->isAccepted()) {
            throw new RateLimitExceededException('Geocoder user rate limit exceeded');
        }
    }
}
