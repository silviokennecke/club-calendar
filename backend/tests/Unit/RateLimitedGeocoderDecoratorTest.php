<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Exception\RateLimitExceededException;
use App\Service\Map\RateLimitedGeocoderDecorator;
use App\Service\Map\RequestUserContext;
use App\Tests\Helper\FakeGeocoder;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;
use PHPUnit\Framework\TestCase;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimit;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

class RateLimitedGeocoderDecoratorTest extends TestCase
{
    private function makeFactory(bool $accepted): RateLimiterFactoryInterface
    {
        $limit = $this->createStub(RateLimit::class);
        $limit->method('isAccepted')->willReturn($accepted);
        $limiter = $this->createStub(LimiterInterface::class);
        $limiter->method('consume')->willReturn($limit);
        $factory = $this->createStub(RateLimiterFactoryInterface::class);
        $factory->method('create')->willReturn($limiter);

        return $factory;
    }

    private function makeDecorator(bool $systemAccepted, bool $userAccepted): RateLimitedGeocoderDecorator
    {
        $inner = new FakeGeocoder();
        $userContext = $this->createStub(RequestUserContext::class);
        $userContext->method('getUserIdentifier')->willReturn('user-1');

        return new RateLimitedGeocoderDecorator(
            $inner,
            $this->makeFactory($systemAccepted),
            $this->makeFactory($userAccepted),
            $userContext,
        );
    }

    public function testSuggestPassesThroughWhenLimitersAccept(): void
    {
        $result = $this->makeDecorator(true, true)->geocodeQuery(GeocodeQuery::create('test'));
        $this->assertCount(0, $result);
    }

    public function testSuggestThrowsWhenSystemLimitExceeded(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeDecorator(false, true)->geocodeQuery(GeocodeQuery::create('test'));
    }

    public function testSuggestThrowsWhenUserLimitExceeded(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeDecorator(true, false)->geocodeQuery(GeocodeQuery::create('test'));
    }

    public function testReversePassesThroughWhenLimitersAccept(): void
    {
        $result = $this->makeDecorator(true, true)->reverseQuery(ReverseQuery::fromCoordinates(48.1, 11.5));
        $this->assertCount(0, $result);
    }

    public function testReverseThrowsWhenSystemLimitExceeded(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeDecorator(false, true)->reverseQuery(ReverseQuery::fromCoordinates(48.1, 11.5));
    }
}
