<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Telemetry\FeedRequestMetrics;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TelemetryCapture;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class FeedTelemetryTest extends WebTestCase
{
    use TelemetryCapture;

    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private string $eventId;
    /** @var array<string, array{id: string, secret: string}> */
    private array $feeds = [];

    protected function setUp(): void
    {
        $this->enableTelemetry();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $admin = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class), 'admin@example.com');
        $club = TestHelper::createClub($this->em, $admin);
        $cal = TestHelper::createCalendar($this->em, $club, 'A');
        $this->eventId = TestHelper::createEvent($this->em, $cal, ['name' => 'E', 'date' => (new \DateTimeImmutable('+10 days'))->format('Y-m-d'), 'isDraft' => false])->getId();
        foreach ([FeedVisibility::PUBLIC, FeedVisibility::CLUB, FeedVisibility::PRIVATE] as $v) {
            $feed = TestHelper::createFeed($this->em, $this->em->find(Club::class, $club->getId()), [$cal], $v);
            $this->feeds[strtolower($v->value)] = ['id' => $feed->getId(), 'secret' => $feed->getSharedSecret()];
        }
        $this->clubId = $club->getId();
        $this->adminId = $admin->getId();
        $this->clearPoints();
    }

    private string $clubId;
    private string $adminId;

    protected function tearDown(): void
    {
        $this->resetTelemetryEnv();
        parent::tearDown();
        self::ensureKernelShutdown();
    }

    private function get(string $uri, array $headers = []): int
    {
        $this->client->request('GET', $uri, [], [], $headers);
        $this->em->clear();

        return $this->client->getResponse()->getStatusCode();
    }

    /** @return array<string, int> "visibility/kind/status" => count */
    private function counts(): array
    {
        $out = [];
        foreach ($this->points(FeedRequestMetrics::NAME) as $p) {
            $out[$p['attrs']['visibility'].'/'.$p['attrs']['kind'].'/'.$p['attrs']['status']] = $p['value'];
        }
        ksort($out);

        return $out;
    }

    private function q(string $visibility): string
    {
        return 'private' === $visibility ? '?secret='.$this->feeds['private']['secret'] : '';
    }

    public function testIcsWebEventAndEventIcsPerVisibility(): void
    {
        foreach (['public', 'club', 'private'] as $v) {
            $id = $this->feeds[$v]['id'];
            $q = $this->q($v);
            $this->assertSame(200, $this->get("/api/feed/$id/ics$q"));
            $etag = $this->client->getResponse()->headers->get('ETag');
            $this->assertSame(304, $this->get("/api/feed/$id/ics$q", ['HTTP_IF_NONE_MATCH' => $etag]));
            $this->assertSame(200, $this->get("/api/feed/$id/events$q"));
            $this->assertSame(200, $this->get("/api/feed/$id/events/{$this->eventId}$q"));
            $this->assertSame(200, $this->get("/api/feed/$id/events/{$this->eventId}/ics$q"));
        }
        $expected = [];
        foreach (['public', 'club', 'private'] as $v) {
            foreach (['ics/200', 'ics/304', 'web/200', 'event/200', 'event_ics/200'] as $k) {
                $expected["$v/$k"] = 1;
            }
        }
        ksort($expected);
        $this->assertSame($expected, $this->counts());
    }

    public function testNothingIsCountedWithoutAccess(): void
    {
        $priv = $this->feeds['private']['id'];
        $pub = $this->feeds['public']['id'];
        $this->assertSame(404, $this->get('/api/feed/unknown/ics'));
        $this->assertSame(403, $this->get("/api/feed/$priv/ics?secret=wrong"));
        $this->assertSame(403, $this->get("/api/feed/$priv/ics"));
        $this->assertSame(403, $this->get("/api/feed/$priv/events"));
        $this->assertSame(403, $this->get("/api/feed/$priv/events/{$this->eventId}?secret=wrong"));
        $this->assertSame(403, $this->get("/api/feed/$priv/events/{$this->eventId}/ics?secret=wrong"));
        $this->assertSame(404, $this->get("/api/feed/$pub/events/nope"));
        $this->assertSame(404, $this->get("/api/feed/$pub/events/nope/ics"));
        $this->assertSame(400, $this->get("/api/feed/$pub/events?from=bad"));
        $this->assertSame(403, $this->get("/api/feed/$priv/ics", ['HTTP_IF_NONE_MATCH' => '"x"']));
        $this->assertSame(404, $this->get('/api/feed/me/unknown/ics?secret=x'));
        $this->assertSame([], $this->counts());
    }

    public function testRateLimitedRequestCountsNothing(): void
    {
        putenv('FEED_RATE_LIMIT_PER_IP=1');
        $_ENV['FEED_RATE_LIMIT_PER_IP'] = $_SERVER['FEED_RATE_LIMIT_PER_IP'] = '1';
        try {
            self::ensureKernelShutdown();
            $this->setUp();
            $id = $this->feeds['public']['id'];
            $this->assertSame(200, $this->get("/api/feed/$id/ics"));
            $this->assertSame(429, $this->get("/api/feed/$id/ics"));
            $this->assertSame(['public/ics/200' => 1], $this->counts());
        } finally {
            putenv('FEED_RATE_LIMIT_PER_IP');
            unset($_ENV['FEED_RATE_LIMIT_PER_IP'], $_SERVER['FEED_RATE_LIMIT_PER_IP']);
        }
    }

    public function testPersonalSubscription(): void
    {
        $c = static::getContainer();
        $tokens = $c->get(TokenService::class);
        $user = $this->em->find(\App\Entity\User::class, $this->adminId);
        $auth = TestHelper::authHeader($user, $tokens);
        $r = TestHelper::jsonRequest($this->client, 'PUT', "/api/clubs/{$this->clubId}/my-subscription", ['feedIds' => [$this->feeds['public']['id']], 'targetGroupIds' => []], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->clearPoints();
        $uri = '/api/feed/me/'.$r['body']['id'].'/ics?secret='.rawurlencode($r['body']['secret']);

        $this->assertSame(200, $this->get($uri));
        $etag = $this->client->getResponse()->headers->get('ETag');
        $this->assertSame(304, $this->get($uri, ['HTTP_IF_NONE_MATCH' => $etag]));
        $this->assertSame(404, $this->get('/api/feed/me/'.$r['body']['id'].'/ics?secret=wrong'));

        $this->assertSame(['my_subscription/ics/200' => 1, 'my_subscription/ics/304' => 1], $this->counts());
    }

    public function testDisabledTelemetryChangesNothing(): void
    {
        $this->enableTelemetry(false);
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        $this->assertFalse(static::getContainer()->get(\App\Telemetry\Telemetry::class)->isEnabled());
        $this->assertSame(200, $this->get('/api/feed/'.$this->feeds['public']['id'].'/ics'));
        $this->assertSame([], $this->counts());
    }
}
