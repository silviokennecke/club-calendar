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
 * Three feed states (PUBLIC, CLUB, PRIVATE) and the search engine opt-in `searchable`: access matrix of
 * the public feed API, validation of the option, X-Robots-Tag per feed and duplicating a calendar.
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
    private function feed(Calendar $cal, FeedVisibility $visibility, bool $searchable = false): CalendarFeed
    {
        $feed = new CalendarFeed();
        $feed->setCalendar($cal);
        $feed->setName('Feed '.$visibility->value);
        $feed->setVisibility($visibility);
        $feed->setSearchable($searchable);
        $feed->setSharedSecret(FeedVisibility::PRIVATE === $visibility ? self::SECRET : self::SECRET.'-'.++self::$feedNo);
        self::$em->persist($feed);
        self::$em->flush();

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

    /** @return iterable<string, array{FeedVisibility, bool}> */
    public static function statuses(): iterable
    {
        yield 'PUBLIC' => [FeedVisibility::PUBLIC, false];
        yield 'PUBLIC searchable' => [FeedVisibility::PUBLIC, true];
        yield 'CLUB' => [FeedVisibility::CLUB, false];
        yield 'PRIVATE' => [FeedVisibility::PRIVATE, false];
    }

    // --- Access matrix ---

    #[DataProvider('statuses')]
    public function testAccessMatrix(FeedVisibility $visibility, bool $searchable): void
    {
        ['calendar' => $cal, 'event' => $event] = $this->calendarWithContent();
        $feed = $this->feed($cal, $visibility, $searchable);

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
                $this->assertSame(FeedVisibility::PUBLIC === $visibility && $searchable, $r['body']['feed']['indexable'], $label);
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
    public function testArchivedCalendarStays404AndTheSecretIsCheckedFirst(FeedVisibility $visibility, bool $searchable): void
    {
        ['calendar' => $cal, 'event' => $event] = $this->calendarWithContent();
        $feed = $this->feed($cal, $visibility, $searchable);
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
            'PUBLIC searchable' => [$this->feed($cal, FeedVisibility::PUBLIC, true), null],
            'PUBLIC' => [$this->feed($cal, FeedVisibility::PUBLIC), 'noindex'],
            'CLUB' => [$this->feed($cal, FeedVisibility::CLUB), 'noindex'],
            // Not possible via the API; the entity must not treat it as indexable either
            'CLUB with stale searchable flag' => [$this->feed($cal, FeedVisibility::CLUB, true), 'noindex'],
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

        $indexable = $cases['PUBLIC searchable'][0]->getId();
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

    // --- Feed API: defaults and validation of `searchable` ---

    public function testNewFeedsAreClubAndNotSearchableByDefault(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $base = "/api/calendars/{$cal->getId()}/feeds";

        $r = $this->req('POST', $base.'?includeSecret=1', $this->auth($user), ['name' => 'Ohne Angabe']);
        $this->assertSame(201, $r['status']);
        $this->assertSame('CLUB', $r['body']['visibility']);
        $this->assertFalse($r['body']['searchable']);
        $this->assertFalse($r['body']['indexable']);
        $this->assertNotSame('', $r['body']['sharedSecret']);

        $public = $this->req('POST', $base, $this->auth($user), ['name' => 'Öffentlich', 'visibility' => 'PUBLIC']);
        $this->assertSame(201, $public['status']);
        $this->assertFalse($public['body']['searchable'], 'opt-in: PUBLIC is not searchable by default');

        $stored = self::$em->getRepository(CalendarFeed::class)->find($r['body']['id']);
        $this->assertSame(FeedVisibility::CLUB, $stored->getVisibility());
    }

    public function testSearchableIsOnlyAllowedForPublicFeeds(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $base = "/api/calendars/{$cal->getId()}/feeds";

        foreach (['CLUB', 'PRIVATE', null] as $visibility) {
            $data = ['name' => 'X', 'searchable' => true] + (null === $visibility ? [] : ['visibility' => $visibility]);
            $r = $this->req('POST', $base, $auth, $data);
            $this->assertSame(422, $r['status'], (string) $visibility);
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame('searchable', $r['body']['field']);
        }
        $this->assertSame(0, self::$em->getRepository(CalendarFeed::class)->count([]), 'nothing created');

        // false is fine for every status
        $club = $this->req('POST', $base, $auth, ['name' => 'Verein', 'visibility' => 'CLUB', 'searchable' => false]);
        $this->assertSame(201, $club['status']);
        $this->assertFalse($club['body']['searchable']);

        $bad = $this->req('POST', $base, $auth, ['name' => 'X', 'visibility' => 'PUBLIC', 'searchable' => 'yes']);
        $this->assertSame(400, $bad['status']);
        $this->assertSame('searchable', $bad['body']['field']);
        $badVisibility = $this->req('POST', $base, $auth, ['name' => 'X', 'visibility' => 'INTERNAL']);
        $this->assertSame(400, $badVisibility['status']);
        $this->assertSame(['validation_failed', 'visibility'], [$badVisibility['body']['code'], $badVisibility['body']['field']]);

        $public = $this->req('POST', $base, $auth, ['name' => 'Öffentlich', 'visibility' => 'PUBLIC', 'searchable' => true]);
        $this->assertSame(201, $public['status']);
        $this->assertTrue($public['body']['searchable']);
        $this->assertTrue($public['body']['indexable']);
        $id = $public['body']['id'];
        $this->assertTrue($this->req('GET', "$base/$id", $auth)['body']['searchable']);

        // Switching to another status with searchable: true is rejected, nothing changes
        $r = $this->req('PATCH', "$base/$id", $auth, ['visibility' => 'PRIVATE', 'searchable' => true]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('searchable', $r['body']['field']);
        $after = $this->req('GET', "$base/$id", $auth)['body'];
        $this->assertSame(['PUBLIC', true], [$after['visibility'], $after['searchable']]);

        // Switching away from PUBLIC resets the option (the answer has the effective value)
        $r = $this->req('PATCH', "$base/$id", $auth, ['visibility' => 'CLUB']);
        $this->assertSame(200, $r['status']);
        $this->assertSame(['CLUB', false, false], [$r['body']['visibility'], $r['body']['searchable'], $r['body']['indexable']]);
        $this->assertFalse($this->req('GET', "$base/$id", $auth)['body']['searchable']);

        // Back to PUBLIC: still off until opted in again
        $r = $this->req('PATCH', "$base/$id", $auth, ['visibility' => 'PUBLIC']);
        $this->assertFalse($r['body']['searchable']);

        // On a CLUB feed, searchable: true alone is 422
        $clubId = $club['body']['id'];
        $r = $this->req('PATCH', "$base/$clubId", $auth, ['searchable' => true]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('searchable', $r['body']['field']);

        // Status and option together
        $r = $this->req('PATCH', "$base/$clubId", $auth, ['visibility' => 'PUBLIC', 'searchable' => true]);
        $this->assertSame(['PUBLIC', true, true], [$r['body']['visibility'], $r['body']['searchable'], $r['body']['indexable']]);
        $r = $this->req('PATCH', "$base/$clubId", $auth, ['searchable' => false]);
        $this->assertSame(['PUBLIC', false], [$r['body']['visibility'], $r['body']['searchable']]);
        $r = $this->req('PATCH', "$base/$clubId", $auth, ['name' => 'Umbenannt']);
        $this->assertSame(['PUBLIC', false], [$r['body']['visibility'], $r['body']['searchable']]);

        // The list carries the fields as well
        $list = $this->req('GET', $base, $auth)['body'];
        $this->assertSame([false, false], array_column($list, 'searchable'));
    }

    public function testFeedRoutesKeepTenantAndArchiveRules(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $stranger, 'calendar' => $otherCal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->feed($cal, FeedVisibility::PUBLIC);
        $uri = "/api/calendars/{$cal->getId()}/feeds/{$feed->getId()}";

        $this->assertSame(403, $this->req('PATCH', $uri, $this->auth($stranger), ['searchable' => true])['status']);
        // A feed of another calendar through a calendar the user is a member of
        $this->assertSame(404, $this->req('PATCH', "/api/calendars/{$otherCal->getId()}/feeds/{$feed->getId()}", $this->auth($stranger), ['searchable' => true])['status']);

        $cal->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $this->assertSame(403, $this->req('PATCH', $uri, $this->auth($user), ['searchable' => true])['status']);
        self::$em->clear();
        $this->assertFalse(self::$em->find(CalendarFeed::class, $feed->getId())->isSearchable());
    }

    // --- The shared secret is only returned on request ---

    public function testSecretIsOmittedUnlessRequested(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $stranger] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $feed = $this->feed($cal, FeedVisibility::PRIVATE);
        $base = "/api/calendars/{$cal->getId()}/feeds";
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
        $this->assertArrayNotHasKey('sharedSecret', $this->req('POST', $base, $auth, ['name' => 'Neu'])['body']);
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
        $uri = "/api/calendars/{$cal->getId()}/feeds/{$feed->getId()}";
        $public = "/api/feed/{$feed->getId()}/events";
        $this->assertSame(403, $this->req('GET', $public)['status']);

        // PRIVATE → CLUB: reachable without the secret right away; the secret stays the same while open
        $r = $this->req('PATCH', $uri.'?includeSecret=true', $auth, ['visibility' => 'CLUB']);
        $this->assertSame(self::SECRET, $r['body']['sharedSecret']);
        $this->assertSame(200, $this->req('GET', $public)['status']);

        // Changes that keep the feed open do not touch the secret
        $r = $this->req('PATCH', $uri.'?includeSecret=true', $auth, ['visibility' => 'PUBLIC', 'searchable' => true]);
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
        $base = "/api/calendars/{$cal->getId()}/feeds";
        foreach (['public', 'club', 'private', 1, ['PUBLIC'], null, ''] as $value) {
            $r = $this->req('POST', $base, $auth, ['name' => 'X', 'visibility' => $value]);
            $this->assertSame(400, $r['status'], json_encode($value));
            $this->assertSame(['validation_failed', 'visibility'], [$r['body']['code'], $r['body']['field']], json_encode($value));
        }
        foreach (['true', 1, null] as $value) {
            $r = $this->req('POST', $base, $auth, ['name' => 'X', 'visibility' => 'PUBLIC', 'searchable' => $value]);
            $this->assertSame(400, $r['status'], json_encode($value));
            $this->assertSame('searchable', $r['body']['field']);
        }
        $this->assertSame(0, self::$em->getRepository(CalendarFeed::class)->count([]));
    }

    // --- Duplicate a calendar ---

    public function testDuplicatingACalendarKeepsTheStatusButNotTheSearchEngineOption(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $sources = [
            $this->feed($cal, FeedVisibility::PUBLIC, true),
            $this->feed($cal, FeedVisibility::CLUB),
            $this->feed($cal, FeedVisibility::PRIVATE),
        ];
        $auth = $this->auth($user);

        $copy = $this->req('POST', "/api/clubs/{$club->getId()}/calendars/{$cal->getId()}/duplicate", $auth, ['name' => 'Kopie']);
        $this->assertSame(201, $copy['status']);
        $feeds = $this->req('GET', "/api/calendars/{$copy['body']['id']}/feeds?includeSecret=1", $auth)['body'];
        usort($feeds, fn (array $a, array $b) => $a['name'] <=> $b['name']);

        $this->assertSame(['Feed CLUB', 'Feed PRIVATE', 'Feed PUBLIC'], array_column($feeds, 'name'));
        $this->assertSame(['CLUB', 'PRIVATE', 'PUBLIC'], array_column($feeds, 'visibility'));
        $this->assertSame([false, false, false], array_column($feeds, 'searchable'));
        $this->assertSame([false, false, false], array_column($feeds, 'indexable'));
        $sourceSecrets = array_map(fn (CalendarFeed $f) => $f->getSharedSecret(), $sources);
        $this->assertSame([], array_intersect($sourceSecrets, array_column($feeds, 'sharedSecret')), 'new secrets');
        // The source keeps its option
        self::$em->clear();
        $this->assertTrue(self::$em->find(CalendarFeed::class, $sources[0]->getId())->isSearchable());
    }
}
