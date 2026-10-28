<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Service\HolidayCalendarService;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Query;
use Exception;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

class HolidayCalendarServiceTest extends TestCase
{
    private const string SAMPLE_ICS = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:xmas-2026@test
SUMMARY:Christmas Day
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261227
END:VEVENT
BEGIN:VEVENT
UID:newyear-2027@test
SUMMARY:New Year's Day
DTSTART;VALUE=DATE:20270101
DTEND;VALUE=DATE:20270102
END:VEVENT
END:VCALENDAR
ICS;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Build a Query stub that returns itself from setParameter() and does nothing on execute().
     */
    private function makeQueryStub(): Query
    {
        $query = $this->createStub(Query::class);
        $query->method('setParameter')->willReturnSelf();

        return $query;
    }

    /**
     * Build a service backed by a fixed ICS response.
     * Persisted HolidayEvent objects are appended to $captured.
     *
     * @param list<HolidayEvent> $captured
     */
    private function makeService(string $icsContent, array &$captured = []): HolidayCalendarService
    {
        $response = $this->createStub(ResponseInterface::class);
        $response->method('getContent')->willReturn($icsContent);

        $httpClient = $this->createStub(HttpClientInterface::class);
        $httpClient->method('request')->willReturn($response);

        $em = $this->createStub(EntityManagerInterface::class);
        $em->method('persist')->willReturnCallback(function (object $e) use (&$captured): void {
            if ($e instanceof HolidayEvent) {
                $captured[] = $e;
            }
        });
        $em->method('createQuery')->willReturn($this->makeQueryStub());

        return new HolidayCalendarService($httpClient, $em, new \App\Service\CalendarVersionBumper($em->getConnection()), new \App\Service\OpenHolidaysClient($httpClient, new \Symfony\Component\Cache\Adapter\ArrayAdapter()), new \Symfony\Component\Clock\NativeClock(), new \Symfony\Component\Cache\Adapter\ArrayAdapter(), new \Psr\Log\NullLogger());
    }

    private function makeHolidayCalendar(): HolidayCalendar
    {
        $calendar = $this->createStub(Calendar::class);

        return new HolidayCalendar($calendar, 'Test', 'https://example.com/holidays.ics');
    }

    // -------------------------------------------------------------------------
    // Tests from the brief
    // -------------------------------------------------------------------------

    /**
     * TC-1: Two VEVENTs → count returns 2.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testFetchAndStoreReturnsTwoEvents(): void
    {
        $service = $this->makeService(self::SAMPLE_ICS);
        $count = $service->fetchAndStore($this->makeHolidayCalendar());

        $this->assertSame(2, $count);
    }

    /**
     * TC-2: Multi-day event — DTEND exclusive → stored dateEnd is inclusive (DTEND − 1 day).
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testMultiDayEventStoredAsInclusiveEnd(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:xmas@test
SUMMARY:Christmas
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261227
END:VEVENT
END:VCALENDAR
ICS;

        $persisted = [];
        $this->makeService($ics, $persisted)->fetchAndStore($this->makeHolidayCalendar());

        $this->assertCount(1, $persisted);
        $this->assertSame('2026-12-25', $persisted[0]->getDate()->format('Y-m-d'));
        // DTEND 2026-12-27 exclusive → stored as 2026-12-26 inclusive
        $this->assertSame('2026-12-26', $persisted[0]->getDateEnd()?->format('Y-m-d'));
    }

    /**
     * TC-3: Single-day event (DTEND = DTSTART + 1 day) → dateEnd is null.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testSingleDayEventHasNullDateEnd(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:holiday@test
SUMMARY:Single Day
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261226
END:VEVENT
END:VCALENDAR
ICS;

        $persisted = [];
        $this->makeService($ics, $persisted)->fetchAndStore($this->makeHolidayCalendar());

        $this->assertCount(1, $persisted);
        $this->assertNull($persisted[0]->getDateEnd());
    }

    // -------------------------------------------------------------------------
    // Extended coverage
    // -------------------------------------------------------------------------

    /**
     * TC-4: DURATION:P2D on a single-day start →
     *   end = DTSTART + 2 days − 1 day = DTSTART + 1 day.
     *   Because end > start, dateEnd should be stored as start + 1 day.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testEventWithDurationStoredCorrectly(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:duration@test
SUMMARY:Two Day Event
DTSTART;VALUE=DATE:20261225
DURATION:P2D
END:VEVENT
END:VCALENDAR
ICS;

        $persisted = [];
        $this->makeService($ics, $persisted)->fetchAndStore($this->makeHolidayCalendar());

        $this->assertCount(1, $persisted);
        // DTSTART=Dec 25, DURATION=2 days → exclusive end Dec 27 → inclusive Dec 26
        $this->assertSame('2026-12-25', $persisted[0]->getDate()->format('Y-m-d'));
        $this->assertSame('2026-12-26', $persisted[0]->getDateEnd()?->format('Y-m-d'));
    }

    /**
     * TC-5: DURATION:P1D (single-day) → end equals start → dateEnd is null.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testEventWithSingleDayDurationHasNullDateEnd(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:duration1d@test
SUMMARY:One Day Duration Event
DTSTART;VALUE=DATE:20261225
DURATION:P1D
END:VEVENT
END:VCALENDAR
ICS;

        $persisted = [];
        $this->makeService($ics, $persisted)->fetchAndStore($this->makeHolidayCalendar());

        $this->assertCount(1, $persisted);
        $this->assertNull($persisted[0]->getDateEnd());
    }

    /**
     * TC-6: lastFetchedAt is set to a non-null DateTimeImmutable after a successful fetch.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testLastFetchedAtIsSetAfterFetch(): void
    {
        $hc = $this->makeHolidayCalendar();
        $this->assertNull($hc->getLastFetchedAt(), 'Should be null before fetch');

        $this->makeService(self::SAMPLE_ICS)->fetchAndStore($hc);

        $this->assertInstanceOf(\DateTimeImmutable::class, $hc->getLastFetchedAt());
    }

    /**
     * TC-7: The DQL DELETE query is executed before inserting new events.
     *       Verifies the DQL string targets HolidayEvent, the :hc parameter is bound,
     *       and this happens before any HolidayEvent is persisted.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testDeleteQueryIsExecutedBeforeInsert(): void
    {
        $capturedDql = '';
        $deleteCalledAt = -1;
        $persistCallCount = 0;

        $response = $this->createStub(ResponseInterface::class);
        $response->method('getContent')->willReturn(self::SAMPLE_ICS);

        $httpClient = $this->createStub(HttpClientInterface::class);
        $httpClient->method('request')->willReturn($response);

        $hc = $this->makeHolidayCalendar();

        $queryMock = $this->createStub(Query::class);
        $queryMock->method('setParameter')->willReturnCallback(
            function (string $k, mixed $v) use ($queryMock, &$deleteCalledAt, &$persistCallCount) {
                unset($v);
                if ('hc' === $k) {
                    $deleteCalledAt = $persistCallCount;
                }

                return $queryMock;
            },
        );

        $em = $this->createStub(EntityManagerInterface::class);
        $em->method('persist')->willReturnCallback(function (object $e) use (&$persistCallCount): void {
            if ($e instanceof HolidayEvent) {
                ++$persistCallCount;
            }
        });
        $em->method('flush');
        $em->method('createQuery')->willReturnCallback(
            function (string $dql) use ($queryMock, &$capturedDql) {
                $capturedDql = $dql;

                return $queryMock;
            },
        );

        new HolidayCalendarService($httpClient, $em, new \App\Service\CalendarVersionBumper($em->getConnection()), new \App\Service\OpenHolidaysClient($httpClient, new \Symfony\Component\Cache\Adapter\ArrayAdapter()), new \Symfony\Component\Clock\NativeClock(), new \Symfony\Component\Cache\Adapter\ArrayAdapter(), new \Psr\Log\NullLogger())->fetchAndStore($hc);

        $this->assertStringContainsString('DELETE', $capturedDql);
        $this->assertStringContainsString('HolidayEvent', $capturedDql);
        $this->assertSame(0, $deleteCalledAt, 'DELETE must run before any HolidayEvent is persisted');
    }

    /**
     * TC-8: HttpClient throws TransportException → exception propagates out of fetchAndStore().
     *
     * @throws \DateMalformedStringException
     */
    public function testFetchFailurePropagatesException(): void
    {
        $transportException = new class('Connection refused') extends \Exception implements TransportExceptionInterface {};

        $httpClient = $this->createStub(HttpClientInterface::class);
        $httpClient->method('request')->willThrowException($transportException);

        $em = $this->createMock(EntityManagerInterface::class);
        $em->expects($this->never())->method('persist');
        $em->expects($this->never())->method('flush');

        $service = new HolidayCalendarService($httpClient, $em, new \App\Service\CalendarVersionBumper($em->getConnection()), new \App\Service\OpenHolidaysClient($httpClient, new \Symfony\Component\Cache\Adapter\ArrayAdapter()), new \Symfony\Component\Clock\NativeClock(), new \Symfony\Component\Cache\Adapter\ArrayAdapter(), new \Psr\Log\NullLogger());

        $this->expectException(TransportExceptionInterface::class);
        $service->fetchAndStore($this->makeHolidayCalendar());
    }

    /**
     * TC-9: Event with no UID field is skipped gracefully.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testEventWithNoUidIsSkipped(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:No UID Event
DTSTART;VALUE=DATE:20261225
DTEND;VALUE=DATE:20261226
END:VEVENT
END:VCALENDAR
ICS;

        $persisted = [];
        $count = $this->makeService($ics, $persisted)->fetchAndStore($this->makeHolidayCalendar());

        $this->assertCount(0, $persisted, 'Event without UID should be skipped');
        $this->assertSame(0, $count);
    }

    /**
     * TC-10: Empty VCALENDAR (no VEVENTs) → returns 0, flush is still called.
     *
     * @throws TransportExceptionInterface
     * @throws \DateMalformedStringException
     */
    public function testEmptyCalendarReturnsZeroAndFlushes(): void
    {
        $ics = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
END:VCALENDAR
ICS;

        $flushCalled = false;

        $response = $this->createStub(ResponseInterface::class);
        $response->method('getContent')->willReturn($ics);

        $httpClient = $this->createStub(HttpClientInterface::class);
        $httpClient->method('request')->willReturn($response);

        $em = $this->createStub(EntityManagerInterface::class);
        $em->method('flush')->willReturnCallback(function () use (&$flushCalled): void {
            $flushCalled = true;
        });
        $em->method('createQuery')->willReturn($this->makeQueryStub());

        $count = new HolidayCalendarService($httpClient, $em, new \App\Service\CalendarVersionBumper($em->getConnection()), new \App\Service\OpenHolidaysClient($httpClient, new \Symfony\Component\Cache\Adapter\ArrayAdapter()), new \Symfony\Component\Clock\NativeClock(), new \Symfony\Component\Cache\Adapter\ArrayAdapter(), new \Psr\Log\NullLogger())->fetchAndStore($this->makeHolidayCalendar());

        $this->assertSame(0, $count);
        $this->assertTrue($flushCalled, 'flush() must still be called even for an empty feed');
    }
}
