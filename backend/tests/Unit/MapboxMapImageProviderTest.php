<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\Map\MapboxMapImageProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class MapboxMapImageProviderTest extends TestCase
{
    public function testGetImageReturnsResponseBytes(): void
    {
        $fakeBytes = 'FAKEJPEG';
        $mockClient = new MockHttpClient(new MockResponse($fakeBytes, ['http_code' => 200]));
        $provider = new MapboxMapImageProvider($mockClient, 'pk.test_token');

        $result = $provider->getImage(11.575, 48.137, 14, 800, 288);

        $this->assertSame($fakeBytes, $result);
    }

    public function testGetImageBuildsCorrectUrl(): void
    {
        $capturedUrl = '';
        $mockClient = new MockHttpClient(function (string $method, string $url) use (&$capturedUrl): MockResponse {
            $capturedUrl = $url;

            return new MockResponse('bytes');
        });
        $provider = new MapboxMapImageProvider($mockClient, 'pk.mytoken');

        $provider->getImage(11.575, 48.137, 14, 800, 288);

        $this->assertStringContainsString('api.mapbox.com/styles/v1/mapbox/streets-v12/static', $capturedUrl);
        $this->assertStringContainsString('11.575', $capturedUrl);
        $this->assertStringContainsString('48.137', $capturedUrl);
        $this->assertStringContainsString('800x288', $capturedUrl);
        $this->assertStringContainsString('pk.mytoken', $capturedUrl);
    }

    public function testHttpErrorThrowsWithoutTokenInMessageOrChain(): void
    {
        $client = new MockHttpClient(new MockResponse('nope', ['http_code' => 401]));
        $provider = new MapboxMapImageProvider($client, 'pk.secrettoken');

        try {
            $provider->getImage(11.5, 48.1, 14, 800, 288);
            $this->fail('expected exception');
        } catch (\Throwable $e) {
            $this->assertInstanceOf(\App\Exception\MapImageUnavailableException::class, $e);
            $this->assertStringContainsString('HTTP 401', $e->getMessage());
            $this->assertNull($e->getPrevious());
            $this->assertStringNotContainsString('pk.secrettoken', $e->getMessage());
        }
    }

    public function testTransportErrorThrowsWithoutTokenInMessageOrChain(): void
    {
        $client = new MockHttpClient(static fn () => throw new \Symfony\Component\HttpClient\Exception\TransportException('Could not resolve host for "https://api.mapbox.com/x?access_token=pk.secrettoken"'));
        $provider = new MapboxMapImageProvider($client, 'pk.secrettoken');

        try {
            $provider->getImage(11.5, 48.1, 14, 800, 288);
            $this->fail('expected exception');
        } catch (\Throwable $e) {
            $this->assertInstanceOf(\App\Exception\MapImageUnavailableException::class, $e);
            $this->assertStringContainsString('transport error', $e->getMessage());
            $this->assertNull($e->getPrevious());
            $this->assertStringNotContainsString('pk.secrettoken', $e->getMessage());
        }
    }
}
