<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Exception\RateLimitExceededException;
use App\Service\Map\GeocoderInterface;
use App\Service\Map\RateLimitedGeocoderDecorator;
use App\Service\Map\RequestUserContext;
use PHPUnit\Framework\TestCase;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimit;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

class RateLimitedGeocoderDecoratorTest extends TestCase
{
    private function makeFactory(bool $accepted): RateLimiterFactoryInterface
    {
        $limit = $this->createMock(RateLimit::class);
        $limit->method('isAccepted')->willReturn($accepted);
        $limiter = $this->createMock(LimiterInterface::class);
        $limiter->method('consume')->willReturn($limit);
        $factory = $this->createMock(RateLimiterFactoryInterface::class);
        $factory->method('create')->willReturn($limiter);

        return $factory;
    }

    private function makeDecorator(bool $systemAccepted, bool $userAccepted): RateLimitedGeocoderDecorator
    {
        $inner = $this->createMock(GeocoderInterface::class);
        $inner->method('suggest')->willReturn([]);
        $inner->method('reverse')->willReturn(null);
        $userContext = $this->createMock(RequestUserContext::class);
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
        $result = $this->makeDecorator(true, true)->suggest('test');
        $this->assertSame([], $result);
    }

    public function testSuggestThrowsWhenSystemLimitExceeded(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeDecorator(false, true)->suggest('test');
    }

    public function testSuggestThrowsWhenUserLimitExceeded(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeDecorator(true, false)->suggest('test');
    }

    public function testReversePassesThroughWhenLimitersAccept(): void
    {
        $result = $this->makeDecorator(true, true)->reverse(11.5, 48.1);
        $this->assertNull($result);
    }

    public function testReverseThrowsWhenSystemLimitExceeded(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeDecorator(false, true)->reverse(11.5, 48.1);
    }
}
