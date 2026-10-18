<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Location;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * ICS injection (audit M3 / API-54): user-controlled text (location, event, ...) must never add content lines,
 * properties, parameters or components to the member ICS download and the public feed ICS.
 */
class IcsInjectionTest extends WebTestCase
{
    private const PAYLOADS = [
        "Hall\";X-EVIL=1:geo:0,0\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:forged\r\nSUMMARY:Forged",
        "Hall\nBEGIN:VALARM\nACTION:DISPLAY\nEND:VALARM",
        "Hall\rATTACH:http://evil.example/x",
        'Hall";ORGANIZER="mailto:evil@example.org":x;$1 $2 \\0',
        "Hall, with; semi: colon \"quote\" \\ back\x00\x07\x1b\x7f",
    ];

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

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

    /** @return array{0: string, 1: string} member ICS and feed ICS of a calendar with one malicious event per payload */
    private function icsOutputs(): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $calendar = self::$em->find(Calendar::class, $cal->getId());
        $calendar->setName("Cal\r\nBEGIN:VEVENT");
        foreach (self::PAYLOADS as $i => $payload) {
            $loc = new Location();
            $loc->setClub($calendar->getClub());
            $loc->setName($payload);
            $loc->setStreet($payload);
            $loc->setZip("1\r\nX-Z:\"");
            $loc->setCity($payload);
            $loc->setCountry("DE\nEND:VEVENT");
            $loc->setLatitude(48.137154);
            $loc->setLongitude(11.576124);
            self::$em->persist($loc);
            $event = TestHelper::createEvent(self::$em, $calendar, ['name' => $payload, 'date' => '2026-10-0'.($i + 1), 'isDraft' => false]);
            $event->setLocation($loc);
        }
        $feed = TestHelper::createFeed(self::$em, $calendar->getClub(), [$calendar], FeedVisibility::PUBLIC, "Feed\r\nBEGIN:VEVENT", 's');
        $feedId = $feed->getId();
        $auth = TestHelper::authHeader($user, self::$tokens);

        $member = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$calendar->getId()}/events.ics", [], $auth);
        self::$em->clear();
        $this->assertSame(200, $member['status'], $member['content']);
        self::$client->request('GET', "/api/feed/$feedId/ics");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());

        return [$member['content'], (string) self::$client->getResponse()->getContent()];
    }

    /** @return list<string> unfolded content lines */
    private function lines(string $ics): array
    {
        $this->assertStringEndsWith("\r\n", $ics);
        $this->assertDoesNotMatchRegularExpression('/(?<!\r)\n|\r(?!\n)/', $ics, 'only CRLF line breaks');
        $lines = explode("\r\n", substr($ics, 0, -2));
        foreach ($lines as $line) {
            $this->assertLessThanOrEqual(75, strlen($line), 'folded to 75 octets');
            $this->assertDoesNotMatchRegularExpression('/[\x00-\x08\x0B-\x1F\x7F]/', $line);
        }

        return explode("\r\n", preg_replace('/\r\n[ \t]/', '', $ics) ?? '');
    }

    private function assertWellFormed(string $ics): void
    {
        $lines = $this->lines($ics);
        array_pop($lines); // empty element after the trailing CRLF

        $stack = [];
        $begins = [];
        foreach ($lines as $line) {
            if (str_starts_with($line, 'BEGIN:')) {
                $stack[] = substr($line, 6);
                $begins[] = substr($line, 6);
            } elseif (str_starts_with($line, 'END:')) {
                $this->assertSame(substr($line, 4), array_pop($stack), "unbalanced $line");
            }
        }
        $this->assertSame([], $stack);
        $counts = array_count_values($begins);
        $this->assertSame(1, $counts['VCALENDAR']);
        $this->assertSame(count(self::PAYLOADS), $counts['VEVENT'], 'one VEVENT per event, none injected');
        $this->assertArrayNotHasKey('VALARM', $counts);
        $this->assertSame(count(self::PAYLOADS), count(array_filter($lines, fn ($l) => str_starts_with($l, 'UID:event-'))));

        foreach ($lines as $line) {
            $this->assertDoesNotMatchRegularExpression('/^(UID:forged|SUMMARY:Forged|ATTACH|ORGANIZER|ACTION|X-EVIL)/', $line);
            if (str_starts_with($line, 'X-APPLE-STRUCTURED-LOCATION')) {
                // the whole property: fixed parameters, quoted X-ADDRESS/X-TITLE without inner quotes, a plain geo URI
                $this->assertMatchesRegularExpression(
                    '/^X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="[^"]*";X-APPLE-RADIUS=100;X-TITLE="[^"]*":geo:48\.137154,11\.576124$/',
                    $line,
                );
            }
        }
        $this->assertSame(count(self::PAYLOADS), count(array_filter($lines, fn ($l) => str_starts_with($l, 'X-APPLE-STRUCTURED-LOCATION'))));
        $this->assertSame(count(self::PAYLOADS), count(array_filter($lines, fn ($l) => str_starts_with($l, 'GEO:'))));
    }

    public function testMemberIcsDownloadSurvivesInjectionPayloads(): void
    {
        [$member] = $this->icsOutputs();
        $this->assertWellFormed($member);
    }

    public function testPublicFeedIcsSurvivesInjectionPayloads(): void
    {
        [, $feed] = $this->icsOutputs();
        $this->assertWellFormed($feed);
    }

    public function testCoordinatesOutOfRangeDoNotBreakTheFeed(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $calendar = self::$em->find(Calendar::class, $cal->getId());
        $loc = new Location();
        $loc->setClub($calendar->getClub())->setName('Nowhere')->setLatitude(123.0)->setLongitude(11.0);
        self::$em->persist($loc);
        TestHelper::createEvent(self::$em, $calendar, ['name' => 'E', 'isDraft' => false])->setLocation($loc);
        $feed = TestHelper::createFeed(self::$em, $calendar->getClub(), [$calendar], FeedVisibility::PUBLIC, 'F', 's');

        self::$client->request('GET', "/api/feed/{$feed->getId()}/ics");
        $content = (string) self::$client->getResponse()->getContent();
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        $this->assertStringContainsString('LOCATION:Nowhere', $content);
        $this->assertStringNotContainsString('X-APPLE-STRUCTURED-LOCATION', $content);
    }
}
