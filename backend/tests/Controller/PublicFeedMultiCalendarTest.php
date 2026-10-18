<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\EventTargetGroup;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Public feed over several calendars of one club. */
class PublicFeedMultiCalendarTest extends WebTestCase
{
    private const SECRET = 'multi-secret';

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;

    private Club $club;
    private Calendar $a;
    private Calendar $b;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        ['club' => $this->club, 'calendar' => $this->a] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $this->b = TestHelper::createCalendar(self::$em, $this->club, 'Zweiter');
    }

    private function feed(array $calendars, FeedVisibility $v = FeedVisibility::PUBLIC): string
    {
        return TestHelper::createFeed(self::$em, $this->club, $calendars, $v, 'Gesamt', FeedVisibility::PRIVATE === $v ? self::SECRET : null)->getId();
    }

    private function ev(Calendar $c, string $name, string $date, bool $draft = false): \App\Entity\Event
    {
        return TestHelper::createEvent(self::$em, $c, ['name' => $name, 'date' => $date, 'isDraft' => $draft]);
    }

    private function get(string $uri): array
    {
        return TestHelper::jsonRequest(self::$client, 'GET', $uri);
    }

    public function testEventsOfBothCalendarsAreMergedSortedAndDraftsExcluded(): void
    {
        $id = $this->feed([$this->a, $this->b]);
        $this->ev($this->a, 'A2', '2026-07-03');
        $this->ev($this->b, 'B1', '2026-07-02');
        $this->ev($this->a, 'A1', '2026-07-01');
        $this->ev($this->b, 'BDraft', '2026-07-04', true);

        $r = $this->get("/api/feed/$id/events");
        $this->assertSame(200, $r['status']);
        $this->assertSame(['A1', 'B1', 'A2'], array_column($r['body']['events'], 'name'));
        $this->assertSame(3, $r['body']['feed']['eventCount']);
        $this->assertArrayNotHasKey('calendarName', $r['body']['feed']);
        $this->assertSame('Gesamt', $r['body']['feed']['name']);
    }

    public function testOnlySelectedCalendarsAreShown(): void
    {
        $id = $this->feed([$this->b]);
        $this->ev($this->a, 'A', '2026-07-01');
        $this->ev($this->b, 'B', '2026-07-02');
        $this->assertSame(['B'], array_column($this->get("/api/feed/$id/events")['body']['events'], 'name'));
    }

    public function testAudienceFilterAndAudiencesSpanAllCalendars(): void
    {
        $id = $this->feed([$this->a, $this->b]);
        $ga = (new TargetGroup())->setClub($this->club)->setName('Jugend');
        $gb = (new TargetGroup())->setClub($this->club)->setName('Senioren');
        self::$em->persist($ga);
        self::$em->persist($gb);
        $ea = $this->ev($this->a, 'EA', '2026-07-01');
        $eb = $this->ev($this->b, 'EB', '2026-07-02');
        self::$em->persist((new EventTargetGroup())->setEvent($ea)->setTargetGroup($ga));
        self::$em->persist((new EventTargetGroup())->setEvent($eb)->setTargetGroup($gb));
        self::$em->flush();

        $r = $this->get("/api/feed/$id/events");
        $this->assertSame(['Jugend', 'Senioren'], array_column($r['body']['feed']['audiences'], 'name'));
        $r = $this->get("/api/feed/$id/events?targetGroupIds={$gb->getId()}");
        $this->assertSame(['EB'], array_column($r['body']['events'], 'name'));
    }

    public function testHolidaysAreUnitedAndDeduplicatedByUid(): void
    {
        $id = $this->feed([$this->a, $this->b]);
        $hcA = new HolidayCalendar($this->a, 'Ferien', 'https://example.com/a.ics');
        $hcB = new HolidayCalendar($this->b, 'Ferien', 'https://example.com/b.ics');
        self::$em->persist($hcA);
        self::$em->persist($hcB);
        self::$em->persist(new HolidayEvent($hcA, 'same', 'Ferien', new \DateTimeImmutable('2026-07-10')));
        self::$em->persist(new HolidayEvent($hcB, 'same', 'Ferien', new \DateTimeImmutable('2026-07-10')));
        self::$em->persist(new HolidayEvent($hcB, 'only-b', 'Nur B', new \DateTimeImmutable('2026-07-05')));
        self::$em->persist(new HolidayEvent($hcA, '', 'Ohne UID', new \DateTimeImmutable('2026-07-20')));
        self::$em->persist(new HolidayEvent($hcB, '', 'Ohne UID', new \DateTimeImmutable('2026-07-20')));
        self::$em->flush();

        $r = $this->get("/api/feed/$id/events");
        $this->assertSame(['Nur B', 'Ferien', 'Ohne UID', 'Ohne UID'], array_column($r['body']['holidays'], 'name'));
    }

    public function testIcsHasEventsOfAllCalendarsButNoHolidays(): void
    {
        $id = $this->feed([$this->a, $this->b]);
        $this->ev($this->a, 'Termin A', '2026-07-01');
        $this->ev($this->b, 'Termin B', '2026-07-02');
        $hc = new HolidayCalendar($this->a, 'Ferien', 'https://example.com/a.ics');
        self::$em->persist($hc);
        self::$em->persist(new HolidayEvent($hc, 'h', 'Sommerferien', new \DateTimeImmutable('2026-07-10')));
        self::$em->flush();

        self::$client->request('GET', "/api/feed/$id/ics");
        $ics = self::$client->getResponse()->getContent();
        $this->assertStringContainsString('Termin A', $ics);
        $this->assertStringContainsString('Termin B', $ics);
        $this->assertStringNotContainsString('Sommerferien', $ics);
    }

    public function testArchivedCalendarDropsOutAndAllArchivedIs404(): void
    {
        $id = $this->feed([$this->a, $this->b]);
        $ea = $this->ev($this->a, 'A', '2026-07-01');
        $eb = $this->ev($this->b, 'B', '2026-07-02');
        $hc = new HolidayCalendar($this->a, 'Ferien', 'https://example.com/a.ics');
        self::$em->persist($hc);
        self::$em->persist(new HolidayEvent($hc, 'h', 'Ferien A', new \DateTimeImmutable('2026-07-10')));
        $this->a->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();

        $r = $this->get("/api/feed/$id/events");
        $this->assertSame(200, $r['status']);
        $this->assertSame(['B'], array_column($r['body']['events'], 'name'));
        $this->assertSame([], $r['body']['holidays']);
        $this->assertSame(404, $this->get("/api/feed/$id/events/{$ea->getId()}")['status']);
        $this->assertSame(200, $this->get("/api/feed/$id/events/{$eb->getId()}")['status']);

        $this->b->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        foreach (["/api/feed/$id/events", "/api/feed/$id/ics", "/api/feed/$id/events/{$eb->getId()}"] as $uri) {
            $this->assertSame(404, $this->get($uri)['status'], $uri);
        }
    }

    public function testPrivateMultiCalendarFeedNeedsTheSecretAndServesSecondCalendarEvent(): void
    {
        $id = $this->feed([$this->a, $this->b], FeedVisibility::PRIVATE);
        $eb = $this->ev($this->b, 'B', '2026-07-02');

        $this->assertSame(403, $this->get("/api/feed/$id/events")['status']);
        $this->assertSame(403, $this->get("/api/feed/$id/events/{$eb->getId()}?secret=wrong")['status']);
        $r = $this->get("/api/feed/$id/events/{$eb->getId()}?secret=".self::SECRET);
        $this->assertSame(200, $r['status']);
        $this->assertSame('B', $r['body']['event']['name']);
        $this->assertSame(['B'], array_column($this->get("/api/feed/$id/events?secret=".self::SECRET)['body']['events'], 'name'));
    }
}
