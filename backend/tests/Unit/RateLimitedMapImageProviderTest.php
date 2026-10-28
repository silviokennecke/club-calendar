<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Exception\RateLimitExceededException;
use App\Service\Map\MapImageProviderInterface;
use App\Service\Map\RateLimitedMapImageProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimit;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;

class RateLimitedMapImageProviderTest extends TestCase
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

    public function testPassesThroughWhenLimiterAccepts(): void
    {
        $inner = $this->createStub(MapImageProviderInterface::class);
        $inner->method('getImage')->willReturn('JPEG');

        $result = new RateLimitedMapImageProvider($inner, $this->makeFactory(true))
            ->getImage(11.5, 48.1, 14, 800, 288);

        $this->assertSame('JPEG', $result);
    }

    public function testThrowsWhenLimiterExhausted(): void
    {
        $inner = $this->createStub(MapImageProviderInterface::class);

        $this->expectException(RateLimitExceededException::class);
        new RateLimitedMapImageProvider($inner, $this->makeFactory(false))
            ->getImage(11.5, 48.1, 14, 800, 288);
    }
}
