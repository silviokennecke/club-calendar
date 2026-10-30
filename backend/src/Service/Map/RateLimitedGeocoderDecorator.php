<?php

declare(strict_types=1);

namespace App\Service\Map;

use App\Exception\RateLimitExceededException;
use Geocoder\Collection;
use Geocoder\Provider\Provider;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

readonly class RateLimitedGeocoderDecorator implements Provider
{
    public function __construct(
        private Provider $inner,
        private RateLimiterFactoryInterface $geocoderSystemLimiter,
        private RateLimiterFactoryInterface $geocoderUserLimiter,
        private RequestUserContext $userContext,
    ) {
    }

    public function geocodeQuery(GeocodeQuery $query): Collection
    {
        $this->consume();

        return $this->inner->geocodeQuery($query);
    }

    public function reverseQuery(ReverseQuery $query): Collection
    {
        $this->consume();

        return $this->inner->reverseQuery($query);
    }

    public function getName(): string
    {
        return $this->inner->getName();
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
