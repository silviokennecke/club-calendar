<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Rate limits of the public feed endpoints (AuthRateLimiter::assertFeedAllowed). The limits come from env
 * variables, set small here before a fresh kernel boots. Feed ids are unknown on purpose: the limit applies
 * before any lookup, so a known feed would behave the same.
 */
class FeedRateLimitTest extends WebTestCase
{
    private const VARS = ['FEED_RATE_LIMIT_PER_IP', 'FEED_RATE_LIMIT_PER_FEED'];

    protected function tearDown(): void
    {
        foreach (self::VARS as $v) {
            putenv($v);
            unset($_ENV[$v], $_SERVER[$v]);
        }
        parent::tearDown();
        self::ensureKernelShutdown();
    }

    private function client(int $perIp, int $perFeed): KernelBrowser
    {
        foreach ([self::VARS[0] => $perIp, self::VARS[1] => $perFeed] as $k => $v) {
            putenv("$k=$v");
            $_ENV[$k] = $_SERVER[$k] = (string) $v;
        }
        self::ensureKernelShutdown();
        $client = static::createClient();
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));

        return $client;
    }

    /** @return array{int, ?string, string} */
    private function get(KernelBrowser $client, string $uri, string $ip = '203.0.113.7'): array
    {
        $client->request('GET', $uri, [], [], ['REMOTE_ADDR' => $ip]);
        $r = $client->getResponse();

        return [$r->getStatusCode(), $r->headers->get('Retry-After'), json_decode((string) $r->getContent(), true)['code'] ?? ''];
    }

    public function testPerIpLimitAppliesToAllThreeRoutesAndOtherIpIsUnaffected(): void
    {
        $c = $this->client(3, 1000);
        $this->assertSame(404, $this->get($c, '/api/feed/a/ics')[0]);
        $this->assertSame(404, $this->get($c, '/api/feed/b/events')[0]);
        $this->assertSame(404, $this->get($c, '/api/feed/c/events/e1/ics')[0]);

        [$status, $retry, $code] = $this->get($c, '/api/feed/d/ics');
        $this->assertSame(429, $status);
        $this->assertSame('rate_limited', $code);
        $this->assertGreaterThanOrEqual(1, (int) $retry);
        $this->assertLessThanOrEqual(60, (int) $retry);

        $this->assertSame(429, $this->get($c, '/api/feed/e/events')[0]);
        $this->assertSame(404, $this->get($c, '/api/feed/a/ics', '198.51.100.9')[0]);
    }

    public function testPerFeedLimitAcrossIpsLeavesOtherFeedsUntouched(): void
    {
        $c = $this->client(1000, 2);
        $this->assertSame(404, $this->get($c, '/api/feed/same/ics', '203.0.113.1')[0]);
        $this->assertSame(404, $this->get($c, '/api/feed/same/events', '203.0.113.2')[0]);

        [$status, $retry, $code] = $this->get($c, '/api/feed/same/events/x', '203.0.113.3');
        $this->assertSame(429, $status);
        $this->assertSame('rate_limited', $code);
        $this->assertNotNull($retry);

        $this->assertSame(404, $this->get($c, '/api/feed/other/ics', '203.0.113.3')[0]);
    }

    public function testZeroSwitchesLimitsOff(): void
    {
        $c = $this->client(0, 0);
        for ($i = 0; $i < 10; ++$i) {
            $this->assertSame(404, $this->get($c, '/api/feed/zero/ics')[0]);
        }
    }

    public function testZeroPerIpKeepsPerFeedLimit(): void
    {
        $c = $this->client(0, 1);
        $this->assertSame(404, $this->get($c, '/api/feed/f/ics')[0]);
        $this->assertSame(429, $this->get($c, '/api/feed/f/ics')[0]);
    }
}
