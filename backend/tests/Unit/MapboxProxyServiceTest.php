<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Exception\ProxyDeniedException;
use App\Exception\RateLimitExceededException;
use App\Service\Map\MapboxProxyService;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Component\RateLimiter\LimiterInterface;
use Symfony\Component\RateLimiter\RateLimit;
use Symfony\Component\RateLimiter\RateLimiterFactory;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;
use Symfony\Component\RateLimiter\Storage\CacheStorage;

class MapboxProxyServiceTest extends TestCase
{
    /** @var array<int, array{pattern: string, methods: string[], rate_limited: bool}> */
    private array $patterns = [
        ['pattern' => '^/v4/[^/]+/[0-9]+/[0-9]+/[0-9]+', 'methods' => ['GET'], 'rate_limited' => true],
        ['pattern' => '^/styles/', 'methods' => ['GET'], 'rate_limited' => false],
        ['pattern' => '^/fonts/', 'methods' => ['GET'], 'rate_limited' => false],
    ];

    private function makeAcceptingFactory(): RateLimiterFactory
    {
        return new RateLimiterFactory([
            'id' => 'test_proxy',
            'policy' => 'fixed_window',
            'limit' => 1000,
            'interval' => '1 day',
        ], new CacheStorage(new ArrayAdapter()));
    }

    private function makeDenyingFactory(): RateLimiterFactoryInterface
    {
        $limit = $this->createMock(RateLimit::class);
        $limit->method('isAccepted')->willReturn(false);
        $limiter = $this->createMock(LimiterInterface::class);
        $limiter->method('consume')->willReturn($limit);
        $factory = $this->createMock(RateLimiterFactoryInterface::class);
        $factory->method('create')->willReturn($limiter);

        return $factory;
    }

    private function makeService(bool $limiterAccepts = true): MapboxProxyService
    {
        return new MapboxProxyService(
            $this->patterns,
            new ArrayAdapter(),
            $limiterAccepts ? $this->makeAcceptingFactory() : $this->makeDenyingFactory(),
            new MockHttpClient(new MockResponse('{}', ['http_code' => 200])),
            'test-token',
        );
    }

    public function testThrowsProxyDeniedExceptionForUnmatchedPath(): void
    {
        $this->expectException(ProxyDeniedException::class);
        $this->makeService()->proxy('unknown/path', 'GET', [], null, 'application/json');
    }

    public function testThrowsProxyDeniedExceptionForDisallowedMethod(): void
    {
        $this->expectException(ProxyDeniedException::class);
        $this->makeService()->proxy('v4/mapbox.satellite/1/1/1', 'POST', [], null, 'application/json');
    }

    public function testAllowsMatchedPatternAndReturnsProxyResponse(): void
    {
        $result = $this->makeService()->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');
        $this->assertSame(200, $result->status);
        $this->assertSame('{}', $result->body);
    }

    public function testAllowsStylesPatternWithoutRateLimit(): void
    {
        $result = $this->makeService(false)->proxy('styles/mapbox/light-v11', 'GET', [], null, 'application/json');
        $this->assertSame(200, $result->status);
    }

    public function testThrowsRateLimitExceededWhenLimiterExhausted(): void
    {
        $this->expectException(RateLimitExceededException::class);
        $this->makeService(false)->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');
    }

    public function testCachesSuccessfulGetResponse(): void
    {
        $httpClient = new MockHttpClient([new MockResponse('{"tile":1}', ['http_code' => 200])]);
        $service = new MapboxProxyService(
            $this->patterns,
            new ArrayAdapter(),
            $this->makeAcceptingFactory(),
            $httpClient,
            'test-token',
        );

        $first = $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');
        $second = $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');

        $this->assertSame($first->body, $second->body);
        $this->assertSame(1, $httpClient->getRequestsCount());
    }

    public function testDoesNotCacheErrorResponse(): void
    {
        $httpClient = new MockHttpClient([
            new MockResponse('error', ['http_code' => 500]),
            new MockResponse('error', ['http_code' => 500]),
        ]);
        $service = new MapboxProxyService(
            $this->patterns,
            new ArrayAdapter(),
            $this->makeAcceptingFactory(),
            $httpClient,
            'test-token',
        );

        $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');
        $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');

        $this->assertSame(2, $httpClient->getRequestsCount());
    }

    public function testCaches404Response(): void
    {
        $httpClient = new MockHttpClient([new MockResponse('not found', ['http_code' => 404])]);
        $service = new MapboxProxyService(
            $this->patterns,
            new ArrayAdapter(),
            $this->makeAcceptingFactory(),
            $httpClient,
            'test-token',
        );

        $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');
        $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');

        $this->assertSame(1, $httpClient->getRequestsCount());
    }

    public function testCacheKeyIsIndependentOfAccessTokenParam(): void
    {
        $httpClient = new MockHttpClient([new MockResponse('{}', ['http_code' => 200])]);
        $service = new MapboxProxyService(
            $this->patterns,
            new ArrayAdapter(),
            $this->makeAcceptingFactory(),
            $httpClient,
            'test-token',
        );

        $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', ['access_token' => 'old'], null, 'application/json');
        $service->proxy('v4/mapbox.satellite/1/1/1', 'GET', [], null, 'application/json');

        $this->assertSame(1, $httpClient->getRequestsCount());
    }
}
