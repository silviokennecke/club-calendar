<?php
declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Enum\FeedVisibility;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use DateMalformedStringException;
use Random\RandomException;
use Doctrine\ORM\EntityManagerInterface;
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
        $container    = static::getContainer();
        self::$em     = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    private function createFeed(int $calendarId, FeedVisibility $visibility = FeedVisibility::PUBLIC, string $secret = 'test-secret'): CalendarFeed
    {
        $feed     = new CalendarFeed();
        $calendar = self::$em->getRepository(Calendar::class)->find($calendarId);
        $feed->setCalendar($calendar);
        $feed->setName('Test Feed');
        $feed->setVisibility($visibility);
        $feed->setSharedSecret($secret);
        self::$em->persist($feed);
        self::$em->flush();
        return $feed;
    }

    public function testIcsReturns404ForNonExistentFeed(): void
    {
        self::$client->request('GET', '/api/feed/99999/ics');
        $this->assertSame(404, self::$client->getResponse()->getStatusCode());
    }

    /**
     * @throws DateMalformedStringException
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
     * @throws DateMalformedStringException
     * @throws RandomException
     */
    public function testIcsReturnsCalendarForPrivateFeedWithCorrectSecret(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $secret = bin2hex(random_bytes(16));
        $feed   = $this->createFeed($cal->getId(), FeedVisibility::PRIVATE, $secret);
        TestHelper::createEvent(self::$em, $cal, ['isDraft' => false]);
        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics?secret=$secret");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        $this->assertStringContainsString('BEGIN:VCALENDAR', (string) self::$client->getResponse()->getContent());
    }

    /**
     * @throws DateMalformedStringException
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
     * @throws DateMalformedStringException
     */
    public function testEventsEndpointReturnsJsonForPublicFeed(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $feed = $this->createFeed($cal->getId());
        TestHelper::createEvent(self::$em, $cal, ['name' => 'JSON Event', 'isDraft' => false]);
        self::$client->request('GET', "/api/feed/{$feed->getId()}/events");
        $r    = self::$client->getResponse();
        $body = json_decode((string) $r->getContent(), true);
        $this->assertSame(200, $r->getStatusCode());
        $this->assertSame('Test Feed', $body['feed']['name']);
        $names = array_column($body['events'], 'name');
        $this->assertContains('JSON Event', $names);
    }
}
