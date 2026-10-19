<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\User;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Three feed states (PUBLIC, CLUB, PRIVATE) (only PUBLIC is indexable): access matrix of
 * the public feed API, X-Robots-Tag per feed and duplicating a calendar.
 */
class FeedStatusTest extends WebTestCase
{
    private const SECRET = 'test-secret-value';

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;
    private static int $feedNo = 0;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    private function auth(User $user): string
    {
        return TestHelper::authHeader($user, self::$tokens);
    }

    /** @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>} */
    private function req(string $method, string $uri, string $auth = '', array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    /** A feed stored directly (secrets are unique, so each feed gets its own; PRIVATE ones the known one). */
    private function feed(Calendar $cal, FeedVisibility $visibility): CalendarFeed
    {
        $feed = TestHelper::createFeed(self::$em, $cal->getClub(), [$cal], $visibility, 'Feed '.$visibility->value, FeedVisibility::PRIVATE === $visibility ? self::SECRET : self::SECRET.'-'.++self::$feedNo);

        return $feed;
    }

    /** Calendar with one published event (2026-10-10) and a holiday (2026-10-03). */
    private function calendarWithContent(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $event = TestHelper::createEvent(self::$em, $cal, ['name' => 'Schützenfest', 'date' => '2026-10-10', 'isDraft' => false]);
        $hc = new HolidayCalendar($cal, 'Ferien', 'https://example.com/ferien.ics');
        self::$em->persist($hc);
        self::$em->persist(new HolidayEvent($hc, 'u1', 'Tag der Einheit', new \DateTimeImmutable('2026-10-03')));
        self::$em->flush();

        return ['user' => $user, 'club' => $club, 'calendar' => $cal, 'event' => $event];
    }

    /** @return array<string, string> label => path below /api/feed/{id} */
    private static function endpoints(string $eventId): array
    {
        return [
            'events' => '/events',
            'single event' => "/events/$eventId",
            'ics' => '/ics',
            'holidays from/to' => '/events?from=2026-10-01&to=2026-10-31',
        ];
    }

    private static function withSecret(string $path, ?string $secret): string
    {
        return null === $secret ? $path : $path.(str_contains($path, '?') ? '&' : '?').'secret='.$secret;
    }

    /** @return iterable<string, array{FeedVisibility}> */
    public static function statuses(): iterable
    {
        yield 'PUBLIC' => [FeedVisibility::PUBLIC];
        yield 'CLUB' => [FeedVisibility::CLUB];
        yield 'PRIVATE' => [FeedVisibility::PRIVATE];
    }

    // --- Access matrix ---

    #[DataProvider('statuses')]
    public function testAccessMatrix(FeedVisibility $visibility): void
    {
        ['calendar' => $cal, 'event' => $event] = $this->calendarWithContent();
        $feed = $this->feed($cal, $visibility);

        foreach (['none' => null, 'right' => self::SECRET, 'wrong' => 'wrong-secret'] as $mode => $secret) {
            foreach (self::endpoints($event->getId()) as $label => $path) {
                $uri = self::withSecret("/api/feed/{$feed->getId()}$path", $secret);
                $r = $this->req('GET', $uri);
                // PUBLIC and CLUB: open by link (a secret is ignored); PRIVATE: only with the right secret
                $expected = FeedVisibility::PRIVATE === $visibility && 'right' !== $mode ? 403 : 200;
                $this->assertSame($expected, $r['status'], "$label, secret $mode");
                if (200 !== $expected) {
                    continue;
                }
                if ('ics' === $label) {
                    $this->assertStringContainsString('Schützenfest', $r['content']);
                    continue;
                }
                $this->assertSame($visibility->value, $r['body']['feed']['visibility'], $label);
                $this->assertSame(FeedVisibility::PUBLIC === $visibility, $r['body']['feed']['indexable'], $label);
                $this->assertArrayNotHasKey('sharedSecret', $r['body']['feed']);
                if ('single event' === $label) {
                    $this->assertSame('Schützenfest', $r['body']['event']['name']);
                } else {
                    $this->assertSame(['Schützenfest'], array_column($r['body']['events'], 'name'), $label);
                    $this->assertSame(['Tag der Einheit'], array_column($r['body']['holidays'], 'name'), $label);
                }
            }
        }
    }

    #[DataProvider('statuses')]
    public function testArchivedCalendarStays404AndTheSecretIsCheckedFirst(FeedVisibility $visibility): void
    {
        ['calendar' => $cal, 'event' => $event] = $this->calendarWithContent();
        $feed = $this->feed($cal, $visibility);
        $cal->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();

        foreach (self::endpoints($event->getId()) as $label => $path) {
            $base = "/api/feed/{$feed->getId()}$path";
            if (FeedVisibility::PRIVATE === $visibility) {
                $this->assertSame(403, $this->req('GET', $base)['status'], $label);
                $this->assertSame(403, $this->req('GET', self::withSecret($base, 'wrong-secret'))['status'], $label);
            }
            $r = $this->req('GET', self::withSecret($base, self::SECRET));
            $this->assertSame(404, $r['status'], $label);
            $this->assertSame('noindex', $r['headers']['x-robots-tag'][0] ?? null, $label);
        }
    }

    // --- Robots header on real responses ---

    public function testRobotsHeaderFollowsTheFeedStatus(): void
    {
        ['calendar' => $cal, 'event' => $event] = $this->calendarWithContent();
        $cases = [
            'PUBLIC' => [$this->feed($cal, FeedVisibility::PUBLIC), null],
            'CLUB' => [$this->feed($cal, FeedVisibility::CLUB), 'noindex'],
            'PRIVATE with secret' => [$this->feed($cal, FeedVisibility::PRIVATE), 'noindex'],
        ];
        foreach ($cases as $label => [$feed, $expected]) {
            foreach (self::endpoints($event->getId()) as $endpoint => $path) {
                $r = $this->req('GET', self::withSecret("/api/feed/{$feed->getId()}$path", self::SECRET));
                $this->assertSame(200, $r['status'], "$label $endpoint");
                $this->assertSame($expected, $r['headers']['x-robots-tag'][0] ?? null, "$label $endpoint");
                $this->assertSame('no-referrer', $r['headers']['referrer-policy'][0] ?? null, "$label $endpoint");
            }
        }

        $indexable = $cases['PUBLIC'][0]->getId();
        $errors = [
            'PRIVATE without secret (403)' => "/api/feed/{$cases['PRIVATE with secret'][0]->getId()}/events",
            'PRIVATE wrong secret (403)' => "/api/feed/{$cases['PRIVATE with secret'][0]->getId()}/ics?secret=wrong-secret",
            'unknown feed (404)' => '/api/feed/unknown/events',
            'unknown event of an indexable feed (404)' => "/api/feed/$indexable/events/unknown",
            'invalid range of an indexable feed (400)' => "/api/feed/$indexable/events?from=2026-13-01",
        ];
        foreach ($errors as $label => $uri) {
            $r = $this->req('GET', $uri);
            $this->assertGreaterThanOrEqual(400, $r['status'], $label);
            $this->assertSame('noindex', $r['headers']['x-robots-tag'][0] ?? null, $label);
            $this->assertSame('no-referrer', $r['headers']['referrer-policy'][0] ?? null, $label);
        }
    }

    // --- Feed API: defaults and indexable ---

    public function testNewFeedsAreClubAndNotIndexableByDefault(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $base = "/api/clubs/{$cal->getClub()->getId()}/feeds";

        $r = $this->req('POST', $base.'?includeSecret=1', $this->auth($user), ['calendarIds' => [$cal->getId()], 'name' => 'Ohne Angabe']);
        $this->assertSame(201, $r['status']);
        $this->assertSame('CLUB', $r['body']['visibility']);
        $this->assertFalse($r['body']['indexable']);
        $this->assertArrayNotHasKey('searchable', $r['body']);
        $this->assertNotSame('', $r['body']['sharedSecret']);

        $public = $this->req('POST', $base, $this->auth($user), ['calendarIds' => [$cal->getId()], 'name' => 'Öffentlich', 'visibility' => 'PUBLIC']);
        $this->assertSame(201, $public['status']);
        $this->assertTrue($public['body']['indexable'], 'PUBLIC is indexable');

        $stored = self::$em->getRepository(CalendarFeed::class)->find($r['body']['id']);
        $this->assertSame(FeedVisibility::CLUB, $stored->getVisibility());
    }

    public function testIndexableFollowsTheVisibility(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/clubs/{$cal->getClub()->getId()}/feeds";

        $badVisibility = $this->req('POST', $base, $auth, ['calendarIds' => [$cal->getId()], 'name' => 'X', 'visibility' => 'INTERNAL']);
        $this->assertSame(400, $badVisibility['status']);
        $this->assertSame(['validation_failed', 'visibility'], [$badVisibility['body']['code'], $badVisibility['body']['field']]);

        $public = $this->req('POST', $base, $auth, ['calendarIds' => [$cal->getId()], 'name' => 'Öffentlich', 'visibility' => 'PUBLIC']);
        $this->assertSame(201, $public['status']);
        $this->assertTrue($public['body']['indexable']);
        $id = $public['body']['id'];
        $this->assertTrue($this->req('GET', "$base/$id", $auth)['body']['indexable']);

        foreach (['CLUB' => false, 'PRIVATE' => false, 'PUBLIC' => true] as $visibility => $indexable) {
            $r = $this->req('PATCH', "$base/$id", $auth, ['visibility' => $visibility]);
            $this->assertSame(200, $r['status']);
            $this->assertSame([$visibility, $indexable], [$r['body']['visibility'], $r['body']['indexable']], $visibility);
            $this->assertSame($indexable, $this->req('GET', "$base/$id", $auth)['body']['indexable'], $visibility);
        }

        // A rename keeps the state; the list carries the field as well
        $r = $this->req('PATCH', "$base/$id", $auth, ['name' => 'Umbenannt']);
        $this->assertSame(['PUBLIC', true], [$r['body']['visibility'], $r['body']['indexable']]);
        $this->assertSame([true], array_column($this->req('GET', $base, $auth)['body'], 'indexable'));
    }

    public function testFeedRoutesKeepTenantRulesAndIgnoreArchiving(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $stranger, 'calendar' => $otherCal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->feed($cal, FeedVisibility::PUBLIC);
        $uri = "/api/clubs/{$cal->getClub()->getId()}/feeds/{$feed->getId()}";

        $this->assertSame(403, $this->req('PATCH', $uri, $this->auth($stranger), ['name' => 'Neu'])['status']);
        // A feed of another calendar through a calendar the user is a member of
        $this->assertSame(404, $this->req('PATCH', "/api/clubs/{$otherCal->getClub()->getId()}/feeds/{$feed->getId()}", $this->auth($stranger), ['name' => 'Neu'])['status']);

        // Archived calendars do not block feed management (feeds belong to the club)
        $cal->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $this->assertSame(200, $this->req('PATCH', $uri, $this->auth($user), ['name' => 'Neu'])['status']);
    }

    // --- The shared secret is only returned on request ---

    public function testSecretIsOmittedUnlessRequested(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $stranger] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $feed = $this->feed($cal, FeedVisibility::PRIVATE);
        $base = "/api/clubs/{$cal->getClub()->getId()}/feeds";
        $one = "$base/{$feed->getId()}";

        // Default: no `sharedSecret` in list, get, create, update and regenerate
        $list = $this->req('GET', $base, $auth);
        $this->assertSame(200, $list['status']);
        $this->assertCount(1, $list['body']);
        $this->assertArrayNotHasKey('sharedSecret', $list['body'][0]);
        $this->assertStringNotContainsString(self::SECRET, $list['content']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req('GET', $one, $auth)['body']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req('GET', $one.'?includeSecret=0', $auth)['body']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req('GET', $one.'?includeSecret=false', $auth)['body']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req('POST', $base, $auth, ['calendarIds' => [$cal->getId()], 'name' => 'Neu'])['body']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req('PATCH', $one, $auth, ['name' => 'X'])['body']);

        // Requested: included everywhere
        $this->assertSame(self::SECRET, $this->req('GET', $base.'?includeSecret=1', $auth)['body'][0]['sharedSecret']);
        $this->assertSame(self::SECRET, $this->req('GET', $one.'?includeSecret=true', $auth)['body']['sharedSecret']);
        $this->assertSame(self::SECRET, $this->req('PATCH', $one.'?includeSecret=1', $auth, ['name' => 'Y'])['body']['sharedSecret']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req('POST', "$one/regenerate-secret", $auth)['body']);
        $new = $this->req('POST', "$one/regenerate-secret?includeSecret=1", $auth)['body']['sharedSecret'];
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $new);
        $this->assertSame($new, $this->req('GET', $one.'?includeSecret=1', $auth)['body']['sharedSecret']);

        // Strict parsing
        foreach (['yes', '2', 'TRUE'] as $bad) {
            $r = $this->req('GET', $one.'?includeSecret='.$bad, $auth);
            $this->assertSame(400, $r['status']);
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame('includeSecret', $r['body']['field']);
        }
        $this->assertSame(400, $this->req('GET', $base.'?includeSecret[]=1', $auth)['status']);

        // Access rules stay: no token 401, non-member 403 (also with the parameter)
        $this->assertSame(401, $this->req('GET', $base.'?includeSecret=1')['status']);
        $this->assertSame(403, $this->req('GET', $base.'?includeSecret=1', $this->auth($stranger))['status']);
        $this->assertSame(403, $this->req('GET', $one.'?includeSecret=1', $this->auth($stranger))['status']);
    }

    // --- Switching the status ---

    public function testSwitchingStatusTakesEffectAtOnceAndBecomingPrivateAgainNeedsANewSecret(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $feed = $this->feed($cal, FeedVisibility::PRIVATE);
        $uri = "/api/clubs/{$cal->getClub()->getId()}/feeds/{$feed->getId()}";
        $public = "/api/feed/{$feed->getId()}/events";
        $this->assertSame(403, $this->req('GET', $public)['status']);

        // PRIVATE → CLUB: reachable without the secret right away; the secret stays the same while open
        $r = $this->req('PATCH', $uri.'?includeSecret=true', $auth, ['visibility' => 'CLUB']);
        $this->assertSame(self::SECRET, $r['body']['sharedSecret']);
        $this->assertSame(200, $this->req('GET', $public)['status']);

        // Changes that keep the feed open do not touch the secret
        $r = $this->req('PATCH', $uri.'?includeSecret=true', $auth, ['visibility' => 'PUBLIC']);
        $this->assertSame(self::SECRET, $r['body']['sharedSecret']);

        // Back to PRIVATE: the old secret (it may have spread while the feed was open) no longer works
        $r = $this->req('PATCH', $uri.'?includeSecret=true', $auth, ['visibility' => 'PRIVATE']);
        $this->assertSame(200, $r['status']);
        $newSecret = $r['body']['sharedSecret'];
        $this->assertNotSame(self::SECRET, $newSecret);
        $this->assertSame(403, $this->req('GET', $public)['status']);
        $this->assertSame(403, $this->req('GET', self::withSecret($public, self::SECRET))['status']);
        $this->assertSame(200, $this->req('GET', self::withSecret($public, $newSecret))['status']);

        // PRIVATE → PRIVATE (e.g. only a rename with the status sent along) keeps the secret
        $r = $this->req('PATCH', $uri.'?includeSecret=true', $auth, ['name' => 'Umbenannt', 'visibility' => 'PRIVATE']);
        $this->assertSame($newSecret, $r['body']['sharedSecret']);
    }

    public function testInvalidStatusValuesAreValidationErrors(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/clubs/{$cal->getClub()->getId()}/feeds";
        foreach (['public', 'club', 'private', 1, ['PUBLIC'], null, ''] as $value) {
            $r = $this->req('POST', $base, $auth, ['calendarIds' => [$cal->getId()], 'name' => 'X', 'visibility' => $value]);
            $this->assertSame(400, $r['status'], json_encode($value));
            $this->assertSame(['validation_failed', 'visibility'], [$r['body']['code'], $r['body']['field']], json_encode($value));
        }
        $this->assertSame(0, self::$em->getRepository(CalendarFeed::class)->count([]));
    }

    // --- Duplicate a calendar ---

    public function testDuplicatingACalendarDoesNotCopyFeeds(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $this->feed($cal, FeedVisibility::PUBLIC);
        $this->feed($cal, FeedVisibility::PRIVATE);
        $auth = $this->auth($user);

        $copy = $this->req('POST', "/api/clubs/{$club->getId()}/calendars/{$cal->getId()}/duplicate", $auth, ['name' => 'Kopie']);
        $this->assertSame(201, $copy['status']);
        $this->assertSame([0, 0], [$copy['body']['feedCount'], $copy['body']['exclusiveFeedCount']]);
        $this->assertSame(2, self::$em->getRepository(CalendarFeed::class)->count([]));
        $feeds = $this->req('GET', "/api/clubs/{$club->getId()}/feeds", $auth)['body'];
        $this->assertCount(2, $feeds);
        foreach ($feeds as $feed) {
            $this->assertSame([$cal->getId()], $feed['calendarIds']);
        }
    }
}
