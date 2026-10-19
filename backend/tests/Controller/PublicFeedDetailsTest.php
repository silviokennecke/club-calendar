<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Event;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Public feed: header (feed, club, club zone, visibility), effective event zone, from/to, holidays
 * and the single-event endpoint (package 1 of BACKEND-PLAN.md).
 */
class PublicFeedDetailsTest extends WebTestCase
{
    private const SECRET = 'test-secret-value';

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    /** @return array{status: int, body: mixed} */
    private function get(string $uri): array
    {
        return TestHelper::jsonRequest(self::$client, 'GET', $uri);
    }

    private function calendar(?string $timezone = null): Calendar
    {
        ['club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $club->setName('Schützenverein Waldblick');
        $cal->setName('Schießbetrieb 2026');
        $cal->setTimezone($timezone);
        self::$em->flush();

        return $cal;
    }

    private function feed(Calendar $cal, FeedVisibility $visibility = FeedVisibility::PUBLIC, ?TargetGroup $group = null): CalendarFeed
    {
        // Secrets are unique: only private feeds get the known one
        $feed = TestHelper::createFeed(self::$em, $cal->getClub(), [$cal], $visibility, 'Alle Termine', FeedVisibility::PRIVATE === $visibility ? self::SECRET : 'public-'.$cal->getId());
        if ($group) {
            self::$em->persist((new CalendarFeedTargetGroup())->setFeed($feed)->setTargetGroup($group));
        }
        self::$em->flush();

        return $feed;
    }

    private function group(Calendar $cal, string $name): TargetGroup
    {
        $group = new TargetGroup();
        $group->setClub($cal->getClub());
        $group->setName($name);
        self::$em->persist($group);
        self::$em->flush();

        return $group;
    }

    /** @param array<string, mixed> $overrides */
    private function event(Calendar $cal, array $overrides = []): Event
    {
        $event = TestHelper::createEvent(self::$em, $cal, $overrides + ['isDraft' => false]);
        if (isset($overrides['dateEnd'])) {
            $event->setDateEnd(new \DateTimeImmutable($overrides['dateEnd']));
        }
        if (array_key_exists('timezone', $overrides)) {
            $event->setTimezone($overrides['timezone']);
        }
        if (isset($overrides['group'])) {
            self::$em->persist((new EventTargetGroup())->setEvent($event)->setTargetGroup($overrides['group']));
        }
        self::$em->flush();

        return $event;
    }

    public function testFeedHeaderNamesFeedClubClubZoneAndVisibility(): void
    {
        $cal = $this->calendar('Europe/Vienna');
        $public = $this->feed($cal);
        $private = $this->feed($cal, FeedVisibility::PRIVATE);

        $r = $this->get("/api/feed/{$public->getId()}/events");
        $this->assertSame(200, $r['status']);
        $this->assertSame([
            'id' => $public->getId(),
            'name' => 'Alle Termine',
            'clubName' => 'Schützenverein Waldblick',
            'timezone' => 'Europe/Berlin',
            'visibility' => 'PUBLIC',
            'indexable' => true,
            'eventCount' => 0,
            'audiences' => [],
        ], $r['body']['feed']);

        $r = $this->get("/api/feed/{$private->getId()}/events?secret=".self::SECRET);
        $this->assertSame('PRIVATE', $r['body']['feed']['visibility']);
        $this->assertArrayNotHasKey('sharedSecret', $r['body']['feed']);
    }

    public function testFeedHeaderCountsPublishedEventsAndNamesTheirAudiencesOverAllDates(): void
    {
        $cal = $this->calendar();
        $youth = $this->group($cal, 'Jugend');
        $adults = $this->group($cal, 'Erwachsene');
        $seniors = $this->group($cal, 'Senioren');
        $this->group($cal, 'Vorstand intern'); // used by no published event: never named
        $feed = $this->feed($cal);
        $limited = $this->feed($cal, FeedVisibility::PRIVATE, $youth);
        $this->event($cal, ['date' => '2026-01-10', 'group' => $youth]);
        $this->event($cal, ['date' => '2026-06-10', 'group' => $adults]);
        $this->event($cal, ['date' => '2026-06-11']);
        $this->event($cal, ['date' => '2026-06-12', 'group' => $seniors, 'isDraft' => true]);

        $r = $this->get("/api/feed/{$feed->getId()}/events?from=2026-06-01&to=2026-06-30");
        $this->assertCount(2, $r['body']['events']);
        $this->assertSame(3, $r['body']['feed']['eventCount']);
        $this->assertSame(['Erwachsene', 'Jugend'], array_column($r['body']['feed']['audiences'], 'name'));
        $this->assertSame($youth->getId(), $r['body']['feed']['audiences'][1]['id']);

        // A feed limited to "Jugend" only counts and names what it shows
        $r = $this->get("/api/feed/{$limited->getId()}/events?secret=".self::SECRET);
        $this->assertSame(1, $r['body']['feed']['eventCount']);
        $this->assertSame(['Jugend'], array_column($r['body']['feed']['audiences'], 'name'));
    }

    public function testZonesFallBackFromEventToCalendarToClub(): void
    {
        $cal = $this->calendar(null); // club: Europe/Berlin
        $feed = $this->feed($cal);
        $own = $this->event($cal, ['name' => 'Eigene Zone', 'timezone' => 'America/New_York']);
        $inherited = $this->event($cal, ['name' => 'Ohne Zone', 'timezone' => null]);

        $r = $this->get("/api/feed/{$feed->getId()}/events");
        $this->assertSame('Europe/Berlin', $r['body']['feed']['timezone']);
        $zones = array_column($r['body']['events'], 'timezone', 'id');
        $this->assertSame('America/New_York', $zones[$own->getId()]);
        $this->assertSame('Europe/Berlin', $zones[$inherited->getId()]);

        $calendar = self::$em->find(Calendar::class, $cal->getId());
        $calendar->setTimezone('Europe/London');
        self::$em->flush();
        $r = $this->get("/api/feed/{$feed->getId()}/events");
        $this->assertSame('Europe/Berlin', $r['body']['feed']['timezone'], 'header zone is the club zone');
        $this->assertSame('Europe/London', array_column($r['body']['events'], 'timezone', 'id')[$inherited->getId()]);
    }

    public function testFromToFiltersByOverlap(): void
    {
        $cal = $this->calendar();
        $feed = $this->feed($cal);
        $this->event($cal, ['name' => 'Davor', 'date' => '2026-09-20']);
        $this->event($cal, ['name' => 'Reicht hinein', 'date' => '2026-09-28', 'dateEnd' => '2026-10-02']);
        $this->event($cal, ['name' => 'Drin', 'date' => '2026-10-15']);
        $this->event($cal, ['name' => 'Danach', 'date' => '2026-11-01']);

        $r = $this->get("/api/feed/{$feed->getId()}/events?from=2026-10-01&to=2026-10-31");
        $this->assertSame(200, $r['status']);
        $this->assertSame(['Reicht hinein', 'Drin'], array_column($r['body']['events'], 'name'));

        $this->assertCount(4, $this->get("/api/feed/{$feed->getId()}/events")['body']['events']);
        $this->assertSame(['Drin', 'Danach'], array_column($this->get("/api/feed/{$feed->getId()}/events?from=2026-10-03")['body']['events'], 'name'));
    }

    public function testInvalidRangeIsABadRequest(): void
    {
        $feed = $this->feed($this->calendar());
        foreach (['from=2026-13-01', 'to=01.10.2026', 'from=tomorrow', 'from=2026-10-31&to=2026-10-01', 'from[]=2026-10-01'] as $query) {
            $this->assertSame(400, $this->get("/api/feed/{$feed->getId()}/events?$query")['status'], $query);
        }
    }

    public function testInvalidRangeDoesNotBypassTheSecret(): void
    {
        $feed = $this->feed($this->calendar(), FeedVisibility::PRIVATE);
        $this->assertSame(403, $this->get("/api/feed/{$feed->getId()}/events?from=invalid")['status']);
    }

    public function testHolidaysOfTheCalendarAreIncludedForTheRange(): void
    {
        $cal = $this->calendar();
        $feed = $this->feed($cal);
        $hc = new HolidayCalendar(self::$em->find(Calendar::class, $cal->getId()), 'Ferien', 'https://example.com/ferien.ics');
        self::$em->persist($hc);
        self::$em->persist(new HolidayEvent($hc, 'u1', 'Herbstferien', new \DateTimeImmutable('2026-09-28'), new \DateTimeImmutable('2026-10-09')));
        self::$em->persist(new HolidayEvent($hc, 'u2', 'Tag der Einheit', new \DateTimeImmutable('2026-10-03')));
        self::$em->persist(new HolidayEvent($hc, 'u3', 'Weihnachten', new \DateTimeImmutable('2026-12-25')));
        // Holidays of another calendar never show up
        $other = $this->calendar();
        $otherHc = new HolidayCalendar(self::$em->find(Calendar::class, $other->getId()), 'Fremd', 'https://example.com/f.ics');
        self::$em->persist($otherHc);
        self::$em->persist(new HolidayEvent($otherHc, 'x', 'Fremder Feiertag', new \DateTimeImmutable('2026-10-05')));
        self::$em->flush();

        $r = $this->get("/api/feed/{$feed->getId()}/events?from=2026-10-01&to=2026-10-31");
        $this->assertSame(['Herbstferien', 'Tag der Einheit'], array_column($r['body']['holidays'], 'name'));
        $this->assertSame([
            'id' => $r['body']['holidays'][0]['id'],
            'holidayCalendarId' => $hc->getId(),
            'name' => 'Herbstferien',
            'date' => '2026-09-28',
            'dateEnd' => '2026-10-09',
        ], $r['body']['holidays'][0]);

        $all = $this->get("/api/feed/{$feed->getId()}/events");
        $this->assertSame(['Herbstferien', 'Tag der Einheit', 'Weihnachten'], array_column($all['body']['holidays'], 'name'));
    }

    public function testFeedListRunsTheSameNumberOfQueriesForMoreEvents(): void
    {
        $cal = $this->calendar();
        $feed = $this->feed($cal);
        $youth = $this->group($cal, 'Jugend');
        $property = new Property();
        $property->setCalendar($cal);
        $property->setName('Tracht');
        self::$em->persist($property);
        $addEvents = function (int $n) use (&$cal, &$youth, &$property): void {
            for ($i = 0; $i < $n; ++$i) {
                $event = $this->event($cal, ['group' => $youth]);
                self::$em->persist((new EventProperty())->setEvent($event)->setProperty($property));
            }
            self::$em->flush();
            self::$em->clear();
        };

        $addEvents(1);
        QueryCounter::$count = 0;
        $this->get("/api/feed/{$feed->getId()}/events");
        $oneEvent = QueryCounter::$count;

        $cal = self::$em->find(Calendar::class, $cal->getId());
        $youth = self::$em->find(TargetGroup::class, $youth->getId());
        $property = self::$em->find(Property::class, $property->getId());
        $addEvents(5);
        QueryCounter::$count = 0;
        $r = $this->get("/api/feed/{$feed->getId()}/events");
        $this->assertCount(6, $r['body']['events']);
        $this->assertSame('Tracht', $r['body']['events'][5]['properties'][0]['property']['name']);
        $this->assertSame($oneEvent, QueryCounter::$count, 'no query per event');
    }

    // --- Single event ---

    public function testSingleEventOfAPublicFeed(): void
    {
        $cal = $this->calendar('Europe/Berlin');
        $feed = $this->feed($cal);
        $event = $this->event($cal, ['name' => 'Herbstfest', 'timezone' => null]);

        $r = $this->get("/api/feed/{$feed->getId()}/events/{$event->getId()}");
        $this->assertSame(200, $r['status']);
        $this->assertSame('Herbstfest', $r['body']['event']['name']);
        $this->assertSame('Europe/Berlin', $r['body']['event']['timezone']);
        $this->assertSame('Schützenverein Waldblick', $r['body']['feed']['clubName']);
        // Same event serialization as in the list
        $list = $this->get("/api/feed/{$feed->getId()}/events")['body']['events'];
        $this->assertSame($list[0], $r['body']['event']);
    }

    public function testSingleEventChecksTheSecretBeforeAnythingElse(): void
    {
        $cal = $this->calendar();
        $feed = $this->feed($cal, FeedVisibility::PRIVATE);
        $event = $this->event($cal);
        $draft = $this->event($cal, ['isDraft' => true]);
        $uri = "/api/feed/{$feed->getId()}/events";

        $this->assertSame(403, $this->get("$uri/{$event->getId()}")['status']);
        $this->assertSame(403, $this->get("$uri/{$event->getId()}?secret=wrong")['status']);
        // Unknown event and draft look the same as an existing one without the secret (no oracle)
        $this->assertSame(403, $this->get("$uri/unknown")['status']);
        $this->assertSame(403, $this->get("$uri/{$draft->getId()}")['status']);

        $this->assertSame(200, $this->get("$uri/{$event->getId()}?secret=".self::SECRET)['status']);
        $this->assertSame(404, $this->get("$uri/{$draft->getId()}?secret=".self::SECRET)['status']);
        $this->assertSame(404, $this->get("$uri/unknown?secret=".self::SECRET)['status']);
        $this->assertSame(404, $this->get('/api/feed/unknown/events/'.$event->getId())['status']);
    }

    public function testSingleEventOfAnArchivedCalendar(): void
    {
        $cal = $this->calendar();
        $public = $this->feed($cal);
        $private = $this->feed($cal, FeedVisibility::PRIVATE);
        $event = $this->event($cal);
        self::$em->find(Calendar::class, $cal->getId())->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();

        $this->assertSame(404, $this->get("/api/feed/{$public->getId()}/events/{$event->getId()}")['status']);
        // Private: the archive state is only revealed with the secret
        $this->assertSame(403, $this->get("/api/feed/{$private->getId()}/events/{$event->getId()}")['status']);
        $this->assertSame(404, $this->get("/api/feed/{$private->getId()}/events/{$event->getId()}?secret=".self::SECRET)['status']);
    }

    public function testSingleEventRespectsCalendarAndTargetGroupsOfTheFeed(): void
    {
        $cal = $this->calendar();
        $youth = $this->group($cal, 'Jugend');
        $adults = $this->group($cal, 'Erwachsene');
        $feed = $this->feed($cal, FeedVisibility::PUBLIC, $youth);
        $forYouth = $this->event($cal, ['group' => $youth]);
        $forAdults = $this->event($cal, ['group' => $adults]);
        $other = $this->calendar();
        $foreign = $this->event($other);

        $uri = "/api/feed/{$feed->getId()}/events";
        $this->assertSame(200, $this->get("$uri/{$forYouth->getId()}")['status']);
        $this->assertSame(404, $this->get("$uri/{$forAdults->getId()}")['status']);
        $this->assertSame(404, $this->get("$uri/{$foreign->getId()}")['status']);
    }
}
