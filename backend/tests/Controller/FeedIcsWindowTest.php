<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Enum\FeedVisibility;
use App\Service\IcsService;
use App\Service\PublicFeedService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** FEED_ICS_*: default window and cap of the public feed ICS; the member export stays complete. */
class FeedIcsWindowTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private Calendar $calendar;
    private string $feedId;
    private string $auth;

    protected function boot(bool $enabled = true, int $pastDays = 180, int $futureMonths = 24, int $max = 0): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $c->set(PublicFeedService::class, new PublicFeedService(
            $c->get(EntityManagerInterface::class),
            $c->get(IcsService::class),
            $c->get(\App\Ics\IcsEventReader::class),
            $c->get(\App\Repository\HolidayEventRepository::class),
            $c->get('request_stack'),
            $enabled,
            $pastDays,
            $futureMonths,
            $max,
        ));
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        ['club' => $club, 'calendar' => $this->calendar, 'user' => $user] = $this->createCalendar($c->get(UserPasswordHasherInterface::class));
        $this->feedId = TestHelper::createFeed($this->em, $club, [$this->calendar], FeedVisibility::PUBLIC)->getId();
        $this->auth = TestHelper::authHeader($user, $c->get(TokenService::class));
    }

    private function createCalendar(UserPasswordHasherInterface $hasher): array
    {
        $user = TestHelper::createUser($this->em, $hasher);
        $club = TestHelper::createClub($this->em, $user);
        $calendar = TestHelper::createCalendar($this->em, $club);

        return ['club' => $club, 'calendar' => $calendar, 'user' => $user];
    }

    private function ev(string $name, string $date, ?string $end = null): void
    {
        $e = TestHelper::createEvent($this->em, $this->calendar, ['name' => $name, 'date' => $date, 'isDraft' => false]);
        if (null !== $end) {
            $e->setDateEnd(new \DateTimeImmutable($end));
            $this->em->flush();
        }
    }

    private function d(string $modifier): string
    {
        return (new \DateTimeImmutable('today', new \DateTimeZone('UTC')))->modify($modifier)->format('Y-m-d');
    }

    private function publicIcs(): string
    {
        $this->client->request('GET', "/api/feed/{$this->feedId}/ics");
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());

        return (string) $this->client->getResponse()->getContent();
    }

    private function seed(): void
    {
        $this->ev('FarPast', $this->d('-400 days'));
        $this->ev('InPast', $this->d('-100 days'));
        $this->ev('Today', $this->d('today'));
        $this->ev('InFuture', $this->d('+12 months'));
        $this->ev('FarFuture', $this->d('+30 months'));
        $this->ev('Spanning', $this->d('-300 days'), $this->d('-100 days'));
    }

    public function testDefaultWindow(): void
    {
        $this->boot();
        $this->seed();
        $ics = $this->publicIcs();
        foreach (['InPast', 'Today', 'InFuture', 'Spanning'] as $name) {
            $this->assertStringContainsString("SUMMARY:$name", $ics);
        }
        $this->assertStringNotContainsString('SUMMARY:FarPast', $ics);
        $this->assertStringNotContainsString('SUMMARY:FarFuture', $ics);
    }

    public function testWindowDisabled(): void
    {
        $this->boot(enabled: false);
        $this->seed();
        $ics = $this->publicIcs();
        $this->assertStringContainsString('SUMMARY:FarPast', $ics);
        $this->assertStringContainsString('SUMMARY:FarFuture', $ics);
    }

    public function testConfiguredValuesAreRespected(): void
    {
        $this->boot(pastDays: 10, futureMonths: 1);
        $this->seed();
        $ics = $this->publicIcs();
        $this->assertStringContainsString('SUMMARY:Today', $ics);
        $this->assertStringNotContainsString('SUMMARY:InPast', $ics);
        $this->assertStringNotContainsString('SUMMARY:InFuture', $ics);
        $this->assertStringNotContainsString('SUMMARY:Spanning', $ics);
    }

    public function testMaxEventsCapsInDateOrder(): void
    {
        $this->boot(max: 2);
        $this->seed();
        $ics = $this->publicIcs();
        $this->assertSame(2, substr_count($ics, 'BEGIN:VEVENT'));
        $this->assertStringContainsString('SUMMARY:Spanning', $ics);
        $this->assertStringContainsString('SUMMARY:InPast', $ics);
        $this->assertStringNotContainsString('SUMMARY:InFuture', $ics);
    }

    public function testInvalidValuesFail(): void
    {
        $this->boot();
        $this->expectException(\InvalidArgumentException::class);
        $c = static::getContainer();
        new PublicFeedService($this->em, $c->get(IcsService::class), $c->get(\App\Ics\IcsEventReader::class), $c->get(\App\Repository\HolidayEventRepository::class), $c->get('request_stack'), true, -1);
    }

    public function testMemberExportHasNoWindow(): void
    {
        $this->boot(max: 1);
        $this->seed();
        $this->client->request('GET', "/api/calendars/{$this->calendar->getId()}/events.ics", server: ['HTTP_AUTHORIZATION' => $this->auth]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
        $ics = (string) $this->client->getResponse()->getContent();
        $this->assertStringContainsString('SUMMARY:FarPast', $ics);
        $this->assertStringContainsString('SUMMARY:FarFuture', $ics);
        $this->assertSame(6, substr_count($ics, 'BEGIN:VEVENT'));
    }
}
