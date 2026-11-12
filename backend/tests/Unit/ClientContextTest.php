<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\ClientContext;
use App\Security\ClientContextResolver;
use App\Security\HeaderCountryLocationResolver;
use App\Security\UserAgentSummary;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;

class ClientContextTest extends TestCase
{
    /** @return iterable<string, array{string, ?string}> */
    public static function userAgents(): iterable
    {
        yield 'chrome' => ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Chrome 126'];
        yield 'edge' => ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87', 'Edge 126'];
        yield 'opera' => ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0', 'Opera 111'];
        yield 'samsung' => ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Samsung Internet 25'];
        yield 'firefox' => ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Firefox 127'];
        yield 'firefox ios' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15', 'Firefox iOS 127'];
        yield 'chrome ios' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1', 'Chrome Mobile 126'];
        yield 'safari' => ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari 17'];
        yield 'safari ios' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Mobile Safari 17'];
        yield 'curl is not a known browser' => ['curl/8.4.0', null];
        yield 'domain-like family' => ['www.evil.co/1 CFNetwork/1410 Darwin/22', null];
        yield 'unknown' => ['definitely-not-a-browser', null];
        yield 'empty' => ['', null];
    }

    #[DataProvider('userAgents')]
    public function testUserAgentSummary(string $ua, ?string $expected): void
    {
        $this->assertSame($expected, UserAgentSummary::browser($ua));
    }

    private function request(array $server, ?string $country, ?string $trustedProxies): Request
    {
        Request::setTrustedProxies(null === $trustedProxies ? [] : [$trustedProxies], Request::HEADER_X_FORWARDED_FOR);
        $request = Request::create('/', 'GET', [], [], [], $server + ['REMOTE_ADDR' => '10.0.0.1']);
        if (null !== $country) {
            $request->headers->set('CF-IPCountry', $country);
        }

        return $request;
    }

    protected function tearDown(): void
    {
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
    }

    public function testCountryHeaderOnlyFromTrustedProxy(): void
    {
        $r = new HeaderCountryLocationResolver('CF-IPCountry');
        $this->assertSame('DE', $r->resolve($this->request([], 'de', '10.0.0.1'))->country);
        $this->assertNull($r->resolve($this->request([], 'DE', null))->country);
        $this->assertNull($r->resolve($this->request([], 'DE', '192.168.0.1'))->country);
        $this->assertNull($r->resolve($this->request([], 'DE', '10.0.0.1'))->city);
    }

    public function testInvalidCountryValuesRejected(): void
    {
        $r = new HeaderCountryLocationResolver('CF-IPCountry');
        foreach (['XX', 'T1', 'DEU', 'D', '1A', '', 'D E'] as $bad) {
            $this->assertNull($r->resolve($this->request([], $bad, '10.0.0.1'))->country, $bad);
        }
        $this->assertNull($r->resolve($this->request([], null, '10.0.0.1'))->country);
    }

    public function testEmptyHeaderNameDisablesFeature(): void
    {
        $r = new HeaderCountryLocationResolver('');
        $this->assertNull($r->resolve($this->request([], 'DE', '10.0.0.1'))->country);
    }

    public function testResolverBuildsContextFromRequest(): void
    {
        $stack = new RequestStack();
        $stack->push($this->request([
            'HTTP_USER_AGENT' => 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
            'HTTP_X_FORWARDED_FOR' => '203.0.113.9',
        ], 'AT', '10.0.0.1'));
        $ctx = (new ClientContextResolver($stack, new HeaderCountryLocationResolver('CF-IPCountry')))->current();

        $this->assertSame('203.0.113.9', $ctx->ip);
        $this->assertSame('Firefox 127', $ctx->browser);
        $this->assertSame('AT', $ctx->country);
        $this->assertNull($ctx->city);
    }

    public function testCliContextIsEmpty(): void
    {
        $ctx = (new ClientContextResolver(new RequestStack(), new HeaderCountryLocationResolver('CF-IPCountry')))->current();
        $this->assertEquals(new ClientContext(), $ctx);
    }
}
