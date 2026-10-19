<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\EventTargetGroup;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Random\RandomException;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class PublicTest extends WebTestCase
{
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

    private function createFeed(string $calendarId, FeedVisibility $visibility = FeedVisibility::PUBLIC, string $secret = 'test-secret'): CalendarFeed
    {
        $calendar = self::$em->getRepository(Calendar::class)->find($calendarId);

        return TestHelper::createFeed(self::$em, $calendar->getClub(), [$calendar], $visibility, 'Test Feed', $secret);
    }

    public function testFeedApiResponsesSendNoReferrerAndNoindex(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId(), FeedVisibility::CLUB, 'club-secret');
        foreach (["/api/feed/{$feed->getId()}/events", "/api/feed/{$feed->getId()}/ics", '/api/feed/unknown/events'] as $url) {
            self::$client->request('GET', $url);
            $headers = self::$client->getResponse()->headers;
            $this->assertSame('no-referrer', $headers->get('Referrer-Policy'), $url);
            $this->assertSame('noindex', $headers->get('X-Robots-Tag'), $url);
        }
        // PUBLIC feeds are indexable: no noindex on success
        $public = $this->createFeed($cal->getId());
        self::$client->request('GET', "/api/feed/{$public->getId()}/events");
        $this->assertNull(self::$client->getResponse()->headers->get('X-Robots-Tag'));
        // Not a feed route: no Referrer-Policy from the app (the web server sets its general default)
        self::$client->request('GET', '/api/health');
        $this->assertFalse(self::$client->getResponse()->headers->has('Referrer-Policy'));
    }

    public function testIcsReturns404ForNonExistentFeed(): void
    {
        self::$client->request('GET', '/api/feed/99999/ics');
        $this->assertSame(404, self::$client->getResponse()->getStatusCode());
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testIcsReturnsCalendarForPublicFeed(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId());
        TestHelper::createEvent(self::$em, $cal, ['name' => 'Public Event', 'isDraft' => false]);
        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics");
        $r = self::$client->getResponse();
        $this->assertSame(200, $r->getStatusCode());
        $this->assertStringContainsString('text/calendar', (string) $r->headers->get('Content-Type'));
        $this->assertStringContainsString('BEGIN:VCALENDAR', (string) $r->getContent());
        $this->assertStringContainsString('Public Event', (string) $r->getContent());
    }

    /**
     * @throws RandomException
     */
    public function testIcsReturns403ForPrivateFeedWithoutSecret(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId(), FeedVisibility::PRIVATE, bin2hex(random_bytes(16)));
        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics");
        $this->assertSame(403, self::$client->getResponse()->getStatusCode());
    }

    /**
     * @throws \DateMalformedStringException
     * @throws RandomException
     */
    public function testIcsReturnsCalendarForPrivateFeedWithCorrectSecret(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $secret = bin2hex(random_bytes(16));
        $feed = $this->createFeed($cal->getId(), FeedVisibility::PRIVATE, $secret);
        TestHelper::createEvent(self::$em, $cal, ['isDraft' => false]);
        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics?secret=$secret");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        $this->assertStringContainsString('BEGIN:VCALENDAR', (string) self::$client->getResponse()->getContent());
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testIcsExcludesDraftEvents(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId());
        TestHelper::createEvent(self::$em, $cal, ['name' => 'Draft Event',     'isDraft' => true]);
        TestHelper::createEvent(self::$em, $cal, ['name' => 'Published Event', 'isDraft' => false]);
        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics");
        $content = (string) self::$client->getResponse()->getContent();
        $this->assertStringNotContainsString('Draft Event', $content);
        $this->assertStringContainsString('Published Event', $content);
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testEventsEndpointReturnsJsonForPublicFeed(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId());
        TestHelper::createEvent(self::$em, $cal, ['name' => 'JSON Event', 'isDraft' => false]);
        self::$client->request('GET', "/api/feed/{$feed->getId()}/events");
        $r = self::$client->getResponse();
        $body = json_decode((string) $r->getContent(), true);
        $this->assertSame(200, $r->getStatusCode());
        $this->assertSame('Test Feed', $body['feed']['name']);
        $names = array_column($body['events'], 'name');
        $this->assertContains('JSON Event', $names);
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testIcsWritesExclusiveEndForMultiDayAllDayEvent(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId());
        $multi = TestHelper::createEvent(self::$em, $cal, ['name' => 'Reise', 'date' => '2026-10-28', 'isDraft' => false]);
        $multi->setIsAllDay(true);
        $multi->setDateEnd(new \DateTimeImmutable('2026-10-30'));
        $single = TestHelper::createEvent(self::$em, $cal, ['name' => 'Ausflug', 'date' => '2026-10-24', 'isDraft' => false]);
        $single->setIsAllDay(true);
        self::$em->flush();

        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics");
        $content = (string) self::$client->getResponse()->getContent();

        // Last day Oct 30 inclusive -> DTEND Oct 31 (exclusive), not Nov 1
        $this->assertStringContainsString("DTSTART;VALUE=DATE:20261028\r\nDTEND;VALUE=DATE:20261031", $content);
        $this->assertStringNotContainsString('DTEND;VALUE=DATE:20261101', $content);
        $this->assertStringContainsString('DTSTART;VALUE=DATE:20261024', $content);
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testFeedTargetGroupsCannotBeWidenedByQuery(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $youth = new TargetGroup();
        $youth->setClub($cal->getClub());
        $youth->setName('Jugend');
        $adults = new TargetGroup();
        $adults->setClub($cal->getClub());
        $adults->setName('Erwachsene');
        self::$em->persist($youth);
        self::$em->persist($adults);
        foreach ([['Jugendtraining', $youth], ['Erwachsenentraining', $adults]] as [$name, $group]) {
            $event = TestHelper::createEvent(self::$em, $cal, ['name' => $name, 'isDraft' => false]);
            $link = new EventTargetGroup();
            $link->setEvent($event);
            $link->setTargetGroup($group);
            self::$em->persist($link);
        }
        $feed = $this->createFeed($cal->getId());
        $feedLink = new CalendarFeedTargetGroup();
        $feedLink->setFeed($feed);
        $feedLink->setTargetGroup($youth);
        self::$em->persist($feedLink);
        self::$em->flush();
        self::$em->clear();

        $feedId = $feed->getId();
        $youthId = $youth->getId();
        $adultsId = $adults->getId();
        $names = function (string $query) use ($feedId): array {
            self::$client->request('GET', "/api/feed/{$feedId}/events{$query}");
            $body = json_decode((string) self::$client->getResponse()->getContent(), true);

            return array_column($body['events'], 'name');
        };

        $this->assertSame(['Jugendtraining'], $names(''));
        $this->assertSame(['Jugendtraining'], $names('?targetGroupIds='.$youthId));
        // Another audience than the feed's own: nothing, not the other group's events
        $this->assertSame([], $names('?targetGroupIds='.$adultsId));
        $this->assertSame(['Jugendtraining'], $names('?targetGroupIds='.$adultsId.','.$youthId));
        self::$client->request('GET', "/api/feed/{$feedId}/ics?targetGroupIds={$adultsId}");
        $this->assertStringNotContainsString('Erwachsenentraining', (string) self::$client->getResponse()->getContent());
    }

    public function testArchivedPrivateFeedRequiresSecretBeforeRevealingArchiveState(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId(), FeedVisibility::PRIVATE, 'archived-feed-secret');
        $cal->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        foreach (['events', 'ics'] as $endpoint) {
            self::$client->request('GET', "/api/feed/{$feed->getId()}/$endpoint");
            $this->assertSame(403, self::$client->getResponse()->getStatusCode(), $endpoint);
            self::$client->request('GET', "/api/feed/{$feed->getId()}/$endpoint?secret=wrong");
            $this->assertSame(403, self::$client->getResponse()->getStatusCode(), $endpoint);
            self::$client->request('GET', "/api/feed/{$feed->getId()}/$endpoint?secret=archived-feed-secret");
            $this->assertSame(404, self::$client->getResponse()->getStatusCode(), $endpoint);
        }
    }

    /**
     * @throws \DateMalformedStringException
     */
    public function testIcsSurvivesStoredInvalidTimezone(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $cal->setTimezone('America/New_York');
        $feed = $this->createFeed($cal->getId());
        $event = TestHelper::createEvent(self::$em, $cal, ['name' => 'Outlook', 'isDraft' => false]);
        // Stored before validation existed (e.g. a Windows zone name from an Outlook import)
        $event->setTimezone('W. Europe Standard Time');
        self::$em->flush();

        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics");
        $r = self::$client->getResponse();
        $this->assertSame(200, $r->getStatusCode());
        $content = (string) $r->getContent();
        $this->assertStringContainsString('Outlook', $content);
        // Falls back to the calendar time zone (before: club time zone, and the invalid zone broke the feed)
        $this->assertStringContainsString('DTSTART;TZID=America/New_York:20260701T180000', $content);
        // RFC 5545: each TZID needs a VTIMEZONE, otherwise strict clients read floating local time
        $this->assertMatchesRegularExpression('/BEGIN:VTIMEZONE\r?\nTZID:America\/New_York\r?\n/', $content);
        $this->assertSame(1, substr_count($content, 'BEGIN:VTIMEZONE'));
    }
}
