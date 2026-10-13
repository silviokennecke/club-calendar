<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Event series (package 4 of BACKEND-PLAN.md): rule, preview, atomic creation, scope "this" / "all"
 * when editing and deleting, clean-up of series without events. The date vectors are the former
 * client-side cases of frontend/src/lib/events/series.ts (the server is now the only source of truth).
 */
class EventSeriesTest extends WebTestCase
{
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

    /** @return array{string, string, Calendar, string} auth, calendar base path, calendar, club id */
    private function setupCalendar(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return [TestHelper::authHeader($user, self::$tokens), "/api/calendars/{$cal->getId()}", $cal, $club->getId()];
    }

    /** @return array{status: int, body: mixed, content: string} */
    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    private function rule(array $partial = []): array
    {
        return array_merge([
            'frequency' => 'weekly',
            'weekday' => 4,
            'startDate' => '2026-10-03',
            'until' => '2026-10-31',
            'skipHolidays' => false,
        ], $partial);
    }

    /** @return list<string> */
    private function previewDates(string $base, string $auth, array $rule): array
    {
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $rule]);
        $this->assertSame(200, $r['status'], $r['content']);

        return $r['body']['dates'];
    }

    private function addHolidays(Calendar $calendar, array $holidays): void
    {
        $cal = self::$em->find(Calendar::class, $calendar->getId());
        $hc = new HolidayCalendar($cal, 'Feiertage', 'https://example.com/holidays.ics');
        self::$em->persist($hc);
        foreach ($holidays as $i => [$name, $date, $end]) {
            self::$em->persist(new HolidayEvent($hc, "h$i", $name, new \DateTimeImmutable($date), null === $end ? null : new \DateTimeImmutable($end)));
        }
        self::$em->flush();
    }

    private function countRows(string $table, string $calendarId): int
    {
        return (int) self::$em->getConnection()->fetchOne("SELECT COUNT(*) FROM `$table` WHERE calendar_id = ?", [$calendarId]);
    }

    /** Creates a weekly Thursday series in October 2026 (4 events) and returns the response body. */
    private function createSeries(string $base, string $auth, array $extra = []): array
    {
        $r = $this->req('POST', "$base/events/series", $auth, array_merge([
            'rule' => $this->rule(),
            'event' => ['name' => 'Training', 'timeBegin' => '19:00', 'timeEnd' => '21:00'],
        ], $extra));
        $this->assertSame(201, $r['status'], $r['content']);

        return $r['body'];
    }

    // ---- Rule and preview -------------------------------------------------------------------------

    public function testPreviewListsTheDatesOfTheRule(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule()]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'], $r['body']['dates']);
        $this->assertSame(4, $r['body']['count']);
        $this->assertSame([], $r['body']['skippedHolidays']);

        // The start day counts when it is the weekday
        $this->assertSame(['2026-10-03', '2026-10-10'], $this->previewDates($base, $auth, $this->rule(['weekday' => 6, 'until' => '2026-10-10'])));
        // Every second week from the first match
        $this->assertSame(['2026-10-08', '2026-10-22'], $this->previewDates($base, $auth, $this->rule(['frequency' => 'biweekly'])));
        // Preview writes nothing
        self::$em->clear();
        $this->assertSame([], $this->req('GET', "$base/events", $auth)['body']);
    }

    public function testMonthlyRuleFindsTheNthAndTheLastWeekday(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $monthly = $this->rule(['frequency' => 'monthly', 'weekday' => 1, 'startDate' => '2026-09-01', 'until' => '2026-11-30']);

        $this->assertSame(['2026-09-07', '2026-10-05', '2026-11-02'], $this->previewDates($base, $auth, $monthly + ['nth' => 1]));
        $this->assertSame(['2026-10-26'], $this->previewDates($base, $auth, array_merge($monthly, ['nth' => 4, 'startDate' => '2026-10-01', 'until' => '2026-10-31'])));
        $this->assertSame(['2026-09-28', '2026-10-26', '2026-11-30'], $this->previewDates($base, $auth, array_merge($monthly, ['nth' => 5])));
        // A start after the n-th weekday of its month skips that month
        $this->assertSame(['2026-10-05', '2026-11-02'], $this->previewDates($base, $auth, array_merge($monthly, ['nth' => 1, 'startDate' => '2026-09-08'])));
        // monthly needs nth (1–4, 5 = last)
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $monthly]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('rule.nth', $r['body']['field']);
        $this->assertSame(400, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => array_merge($monthly, ['nth' => 6])])['status']);
    }

    public function testDatesAreCalendarDaysAcrossDaylightSavingAndLeapYears(): void
    {
        [$auth, $base] = $this->setupCalendar();

        // Sunday rule over the end of summer time (25 Oct 2026)
        $this->assertSame(['2026-10-25', '2026-11-01'], $this->previewDates($base, $auth, $this->rule(['weekday' => 0, 'startDate' => '2026-10-20', 'until' => '2026-11-02'])));
        // Over the start of summer time (29 Mar 2026)
        $this->assertSame(['2026-03-22', '2026-03-29', '2026-04-05'], $this->previewDates($base, $auth, $this->rule(['weekday' => 0, 'startDate' => '2026-03-22', 'until' => '2026-04-05'])));
        // Leap day 2028 (Tuesday)
        $this->assertSame(['2028-02-22', '2028-02-29', '2028-03-07'], $this->previewDates($base, $auth, $this->rule(['weekday' => 2, 'startDate' => '2028-02-20', 'until' => '2028-03-07'])));
        // Last Tuesday of February in a leap year
        $this->assertSame(['2028-02-29'], $this->previewDates($base, $auth, $this->rule(['frequency' => 'monthly', 'nth' => 5, 'weekday' => 2, 'startDate' => '2028-02-01', 'until' => '2028-02-29'])));
    }

    public function testRuleEndsWithACountOrAnEndDate(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $byCount = $this->rule(['count' => 3]);
        unset($byCount['until']);

        $this->assertSame(['2026-10-08', '2026-10-15', '2026-10-22'], $this->previewDates($base, $auth, $byCount));

        $both = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule(['count' => 3])]);
        $this->assertSame(400, $both['status']);
        $this->assertSame('validation_failed', $both['body']['code']);
        $this->assertSame('rule', $both['body']['field']);

        $neither = $this->rule();
        unset($neither['until']);
        $this->assertSame(400, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $neither])['status']);
        $this->assertSame(400, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => array_merge($byCount, ['count' => 0])])['status']);
    }

    public function testInvalidRulesAreRejectedWithTheirField(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $cases = [
            'rule.frequency' => ['frequency' => 'daily'],
            'rule.weekday' => ['weekday' => 7],
            'rule.startDate' => ['startDate' => '2026-02-30'],
            'rule.until' => ['until' => '2026-10-01'],
            'rule.skipHolidays' => ['skipHolidays' => 'yes'],
        ];
        foreach ($cases as $field => $partial) {
            $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule($partial)]);
            $this->assertSame(400, $r['status'], $field);
            $this->assertSame($field, $r['body']['field'], $field);
            $this->assertSame('validation_failed', $r['body']['code']);
        }
        $this->assertSame(400, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => 'weekly'])['status']);
        $this->assertSame(400, $this->req('POST', "$base/events/series/preview", $auth, [])['status']);
    }

    public function testPreviewWithoutMatchingDaysIsEmpty(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule(['weekday' => 1, 'startDate' => '2026-10-06', 'until' => '2026-10-11'])]);
        $this->assertSame(200, $r['status']);
        $this->assertSame(0, $r['body']['count']);
        $this->assertSame([], $r['body']['dates']);
    }

    public function testHolidaysOfTheCalendarAreSkipped(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $this->addHolidays($cal, [
            ['Tag der Deutschen Einheit', '2026-10-03', null],
            ['Herbstferien', '2026-10-30', '2026-10-31'],
        ]);
        // Holidays of another calendar never count
        [, , $other] = $this->setupCalendar();
        $this->addHolidays($other, [['Fremd', '2026-10-10', null]]);
        $saturdays = $this->rule(['weekday' => 6, 'skipHolidays' => true]);

        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $saturdays]);
        $this->assertSame(['2026-10-10', '2026-10-17', '2026-10-24'], $r['body']['dates']);
        $this->assertSame([['date' => '2026-10-03', 'name' => 'Tag der Deutschen Einheit'], ['date' => '2026-10-31', 'name' => 'Herbstferien']], $r['body']['skippedHolidays']);
        $this->assertSame(3, $r['body']['count']);

        // Not skipped: all dates, the holidays are still named
        $kept = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => array_merge($saturdays, ['skipHolidays' => false])]);
        $this->assertSame(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'], $kept['body']['dates']);
        $this->assertSame([], $kept['body']['skippedHolidays']);
        $this->assertCount(2, $kept['body']['holidays']);

        // A count counts created events, skipped holidays do not use it up
        $byCount = array_merge($saturdays, ['count' => 3]);
        unset($byCount['until']);
        $this->assertSame(['2026-10-10', '2026-10-17', '2026-10-24'], $this->previewDates($base, $auth, $byCount));

        // Multi-day events are skipped when any of their days touches a holiday
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule(['weekday' => 5, 'startDate' => '2026-10-01', 'skipHolidays' => true]), 'event' => ['durationDays' => 1]]);
        $this->assertSame(['2026-10-09', '2026-10-16', '2026-10-23'], $r['body']['dates'], 'Fri 2 Oct (+Sat 3) and Fri 30 Oct are skipped');
        $this->assertSame(['2026-10-02', '2026-10-30'], array_column($r['body']['skippedHolidays'], 'date'));
    }

    public function testTooManyEventsAreRejected(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule(['startDate' => '2026-01-01', 'until' => '2033-12-31'])]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('too_many_events', $r['body']['code']);

        $max = $this->rule(['count' => 366]);
        unset($max['until']);
        $this->assertSame(366, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $max])['body']['count']);
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => array_merge($max, ['count' => 367])]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('too_many_events', $r['body']['code']);
        $this->assertSame('rule.count', $r['body']['field'], 'rejected with the rule, before any date is computed');

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(['startDate' => '2026-01-01', 'until' => '2033-12-31']), 'event' => ['name' => 'X', 'timeBegin' => '10:00', 'timeEnd' => '11:00']]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('too_many_events', $r['body']['code']);
    }

    public function testRulesStayBoundedByHolidaysAndTheLastStorableDay(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $this->addHolidays($cal, [['Immer', '2026-01-01', '9999-12-31']]);
        $byCount = $this->rule(['count' => 5, 'skipHolidays' => true]);
        unset($byCount['until']);

        // A holiday covering every date ends the search instead of running to the year 9999
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $byCount]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('too_many_events', $r['body']['code']);

        // Dates never go past 9999-12-31, also not the end of a multi-day event
        $late = $this->rule(['weekday' => 4, 'startDate' => '9999-12-01', 'count' => 5]);
        unset($late['until']);
        $this->assertSame(['9999-12-02', '9999-12-09', '9999-12-16', '9999-12-23', '9999-12-30'], $this->previewDates($base, $auth, $late));
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => array_merge($late, ['count' => 9]), 'event' => ['durationDays' => 7]]);
        $this->assertSame(['9999-12-02', '9999-12-09', '9999-12-16', '9999-12-23'], $r['body']['dates']);
        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(['startDate' => '9999-12-01', 'until' => '9999-12-31']), 'event' => ['name' => 'X', 'isAllDay' => true, 'durationDays' => 31]]);
        $this->assertSame(422, $r['status'], 'no event ends by 9999-12-31');
        $this->assertSame(0, $this->countRows('event', $cal->getId()));
    }

    public function testAccessRules(): void
    {
        [, $base, $cal, $clubId] = $this->setupCalendar();
        $stranger = TestHelper::authHeader(TestHelper::createUser(self::$em, self::$hasher), self::$tokens);
        $body = ['rule' => $this->rule(), 'event' => ['name' => 'X', 'timeBegin' => '10:00', 'timeEnd' => '11:00']];

        $this->assertSame(403, $this->req('POST', "$base/events/series/preview", $stranger, $body)['status']);
        $this->assertSame(403, $this->req('POST', "$base/events/series", $stranger, $body)['status']);
        $this->assertContains(TestHelper::jsonRequest(self::$client, 'POST', "$base/events/series", $body)['status'], [401, 403]);
        $this->assertSame(0, $this->countRows('event', $cal->getId()));
    }

    public function testArchivedCalendarIsReadOnly(): void
    {
        [$auth, $base, $cal, $clubId] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $first = $series['events'][0]['id'];
        $this->assertSame(200, $this->req('POST', "/api/clubs/$clubId/calendars/{$cal->getId()}/archive", $auth)['status']);

        $this->assertSame(403, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule()])['status']);
        $this->assertSame(403, $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'X', 'timeBegin' => '10:00', 'timeEnd' => '11:00']])['status']);
        $this->assertSame(403, $this->req('PATCH', "$base/events/$first", $auth, ['name' => 'Neu', 'scope' => 'all'])['status']);
        $this->assertSame(403, $this->req('DELETE', "$base/events/$first?scope=all", $auth)['status']);
        // Reading stays possible
        $this->assertSame(200, $this->req('GET', "$base/event-series/{$series['series']['id']}", $auth)['status']);
        $this->assertSame(4, $this->countRows('event', $cal->getId()));
    }

    // ---- Creating ---------------------------------------------------------------------------------

    public function testCreateFromTemplateCreatesTheSeriesAndAllEvents(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $loc = $this->req('POST', "$base/locations", $auth, ['name' => 'Schützenhaus'])['body']['id'];
        $prop = $this->req('POST', "$base/properties", $auth, ['name' => 'Draußen', 'icon' => '🌳'])['body']['id'];
        $group = $this->req('POST', "$base/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $tpl = $this->req('POST', "$base/templates", $auth, [
            'name' => 'Training Luftgewehr', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'timezone' => 'Europe/Berlin',
            'locationId' => $loc, 'propertyIds' => [$prop], 'targetGroupIds' => [$group],
        ])['body']['id'];
        $other = TestHelper::createEvent(self::$em, $cal, ['date' => '2026-10-10']);

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(['skipHolidays' => true]), 'templateId' => $tpl, 'isDraft' => false]);
        $this->assertSame(201, $r['status'], $r['content']);
        $seriesId = $r['body']['series']['id'];
        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $seriesId);
        $this->assertSame($tpl, $r['body']['series']['templateId']);
        $this->assertSame(4, $r['body']['series']['eventCount']);
        $this->assertSame(['frequency' => 'weekly', 'weekday' => 4, 'nth' => null, 'startDate' => '2026-10-03', 'until' => '2026-10-31', 'count' => null, 'skipHolidays' => true, 'durationDays' => 0], $r['body']['series']['rule']);
        $this->assertSame(['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'], array_column($r['body']['events'], 'date'));
        foreach ($r['body']['events'] as $event) {
            $this->assertSame($seriesId, $event['seriesId']);
            $this->assertSame('Training Luftgewehr', $event['name']);
            $this->assertSame(['19:00', '21:00', false, false], [$event['timeBegin'], $event['timeEnd'], $event['isAllDay'], $event['isDraft']]);
            $this->assertSame('Europe/Berlin', $event['timezone']);
            $this->assertSame($tpl, $event['eventTemplateId']);
            $this->assertSame($loc, $event['locationId']);
            $this->assertSame([$prop], array_column($event['properties'], 'propertyId'));
            $this->assertSame([$group], array_column($event['targetGroups'], 'targetGroupId'));
        }
        self::$em->clear();

        // Lists carry seriesId (null for single events), the single GET also the series
        $list = $this->req('GET', "$base/events", $auth)['body'];
        $this->assertCount(5, $list);
        $byId = array_column($list, 'seriesId', 'id');
        $this->assertNull($byId[$other->getId()]);
        $this->assertSame(4, count(array_filter($byId, fn ($s) => $s === $seriesId)));
        $one = $this->req('GET', "$base/events/{$r['body']['events'][1]['id']}", $auth)['body'];
        $this->assertSame($seriesId, $one['series']['id']);
        $this->assertSame(4, $one['series']['eventCount']);
        $this->assertSame('weekly', $one['series']['rule']['frequency']);
        $this->assertArrayNotHasKey('series', $list[0]);

        $get = $this->req('GET', "$base/event-series/$seriesId", $auth);
        $this->assertSame(200, $get['status']);
        $this->assertSame(4, $get['body']['eventCount']);
        $this->assertSame($cal->getId(), $get['body']['calendarId']);
        $this->assertNotEmpty($get['body']['createdAt']);

        // Series events count like any event
        $this->assertSame(5, $this->req('GET', "/api/clubs/{$cal->getClub()->getId()}/calendars/{$cal->getId()}", $auth)['body']['eventCount']);
        $this->assertSame(4, $this->req('GET', "$base/templates/$tpl", $auth)['body']['eventCount']);
    }

    public function testEventFieldsOverrideTheTemplateAndDefaultToDraft(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $tpl = TestHelper::createTemplate(self::$em, $cal, ['name' => 'Vorlage']);

        $r = $this->req('POST', "$base/events/series", $auth, [
            'rule' => $this->rule(), 'templateId' => $tpl->getId(),
            'event' => ['name' => 'Sondertraining', 'timeBegin' => '17:00', 'timeEnd' => '18:30', 'timezone' => 'Europe/Vienna'],
        ]);
        $this->assertSame(201, $r['status'], $r['content']);
        $event = $r['body']['events'][0];
        $this->assertSame(['Sondertraining', '17:00', '18:30', 'Europe/Vienna', true], [$event['name'], $event['timeBegin'], $event['timeEnd'], $event['timezone'], $event['isDraft']]);
    }

    public function testTemplateWithoutTimesCreatesAllDayEvents(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $tpl = $this->req('POST', "$base/templates", $auth, ['name' => 'Vereinsfest'])['body']['id'];

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'templateId' => $tpl]);
        $this->assertSame(201, $r['status'], $r['content']);
        foreach ($r['body']['events'] as $event) {
            $this->assertSame([true, '00:00', '23:59', null], [$event['isAllDay'], $event['timeBegin'], $event['timeEnd'], $event['timezone']]);
        }
    }

    public function testWithoutTemplateTheEventNeedsANameAndTimesOrAllDay(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['timeBegin' => '10:00', 'timeEnd' => '11:00']]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('event.name', $r['body']['field']);
        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'Ohne Zeit']]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('event.timeBegin', $r['body']['field']);
        $this->assertSame(0, $this->countRows('event', $cal->getId()));
        $this->assertSame(0, $this->countRows('event_series', $cal->getId()));

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'Ganztags', 'isAllDay' => true]]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame([true, '00:00', '23:59'], [$r['body']['events'][0]['isAllDay'], $r['body']['events'][0]['timeBegin'], $r['body']['events'][0]['timeEnd']]);
        $this->assertTrue($r['body']['events'][0]['isDraft'], 'draft by default also without a template');

        // event.isDraft is taken (and validated) like the other event fields
        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'Öffentlich', 'isAllDay' => true, 'isDraft' => false]]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertFalse($r['body']['events'][0]['isDraft']);
        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'X', 'isAllDay' => true, 'isDraft' => 'yes']]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('event.isDraft', $r['body']['field']);
    }

    public function testMultiDayEventsGetTheirEndDate(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series", $auth, [
            'rule' => $this->rule(['weekday' => 6, 'startDate' => '2028-02-26', 'until' => '2028-03-04']),
            'event' => ['name' => 'Wochenende', 'isAllDay' => true, 'durationDays' => 1],
        ]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame([['2028-02-26', '2028-02-27'], ['2028-03-04', '2028-03-05']], array_map(fn ($e) => [$e['date'], $e['dateEnd']], $r['body']['events']));
        $this->assertSame(1, $r['body']['series']['rule']['durationDays']);

        $this->assertSame(400, $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'X', 'isAllDay' => true, 'durationDays' => -1]])['status']);
        $r = $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule(), 'event' => ['durationDays' => 32]]);
        $this->assertSame([400, 'event.durationDays'], [$r['status'], $r['body']['field']], 'at most 31 extra days');
        $this->assertSame(200, $this->req('POST', "$base/events/series/preview", $auth, ['rule' => $this->rule(), 'event' => ['durationDays' => 31]])['status']);
        $this->assertSame(400, $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'X', 'isAllDay' => true, 'dateEnd' => '2026-10-10']])['status']);
    }

    public function testTimesStayWallClockOverTheDaylightSavingChange(): void
    {
        [$auth, $base] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series", $auth, [
            'rule' => $this->rule(['weekday' => 0, 'startDate' => '2026-10-18', 'until' => '2026-11-01']),
            'event' => ['name' => 'Frühschoppen', 'timeBegin' => '10:30', 'timeEnd' => '12:00', 'timezone' => 'Europe/Berlin'],
        ]);
        $this->assertSame(['2026-10-18', '2026-10-25', '2026-11-01'], array_column($r['body']['events'], 'date'));
        $this->assertSame(['10:30', '10:30', '10:30'], array_column($r['body']['events'], 'timeBegin'));
    }

    public function testNoDatesMeansNothingIsCreated(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(['weekday' => 1, 'startDate' => '2026-10-06', 'until' => '2026-10-11']), 'event' => ['name' => 'X', 'isAllDay' => true]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('rule', $r['body']['field']);
        $this->assertSame(0, $this->countRows('event_series', $cal->getId()));
    }

    public function testReferencesMustBelongToTheCalendarAndNothingIsSavedOnError(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        [$otherAuth, $otherBase] = $this->setupCalendar();
        $foreignTpl = $this->req('POST', "$otherBase/templates", $otherAuth, ['name' => 'Fremd'])['body']['id'];
        $foreignGroup = $this->req('POST', "$otherBase/target-groups", $otherAuth, ['name' => 'Fremd'])['body']['id'];
        $prop = $this->req('POST', "$base/properties", $auth, ['name' => 'Eigen'])['body']['id'];

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'templateId' => $foreignTpl]);
        $this->assertSame(422, $r['status']);
        $this->assertSame(['unknown_reference', 'templateId'], [$r['body']['code'], $r['body']['field']]);

        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'X', 'isAllDay' => true, 'targetGroupIds' => [$foreignGroup]]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('unknown_reference', $r['body']['code']);
        $this->assertSame(0, $this->countRows('event', $cal->getId()));
        $this->assertSame(0, $this->countRows('event_series', $cal->getId()));

        // Duplicate ids are linked once
        $r = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'event' => ['name' => 'X', 'isAllDay' => true, 'propertyIds' => [$prop, $prop, strtoupper($prop)]]]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertCount(1, $r['body']['events'][0]['properties']);
    }

    public function testSeriesOfAnotherCalendarIsNotFound(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        [$otherAuth, $otherBase] = $this->setupCalendar();

        $this->assertSame(404, $this->req('GET', "$otherBase/event-series/{$series['series']['id']}", $otherAuth)['status']);
        $this->assertSame(403, $this->req('GET', "$base/event-series/{$series['series']['id']}", $otherAuth)['status']);
        $this->assertSame(404, $this->req('GET', "$base/event-series/00000000-0000-0000-0000-000000000000", $auth)['status']);
    }

    // ---- Editing with scope -----------------------------------------------------------------------

    public function testEditingOneEventKeepsItInTheSeries(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        [$a, $b] = array_column($series['events'], 'id');

        // Default scope "this" (backwards compatible)
        $r = $this->req('PATCH', "$base/events/$b", $auth, ['name' => 'Sondertraining', 'date' => '2026-10-16']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame($series['series']['id'], $r['body']['seriesId']);
        self::$em->clear();
        $this->assertSame('Training', $this->req('GET', "$base/events/$a", $auth)['body']['name']);
        $this->assertSame(4, $this->req('GET', "$base/event-series/{$series['series']['id']}", $auth)['body']['eventCount']);

        $this->assertSame(200, $this->req('PATCH', "$base/events/$a", $auth, ['name' => 'Nur hier', 'scope' => 'this'])['status']);
        $r = $this->req('PATCH', "$base/events/$a", $auth, ['name' => 'X', 'scope' => 'some']);
        $this->assertSame(400, $r['status']);
        $this->assertSame('scope', $r['body']['field']);
    }

    public function testEditingAllEventsAppliesTheSentFieldsButNotTheDate(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $loc = $this->req('POST', "$base/locations", $auth, ['name' => 'Halle'])['body']['id'];
        $group = $this->req('POST', "$base/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $feature = $this->req('POST', "$base/features", $auth, ['name' => 'Bonusschießen'])['body']['id'];
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id');
        $single = TestHelper::createEvent(self::$em, $cal, ['name' => 'Einzeln', 'date' => '2026-10-15']);
        // Event 3 was edited on its own before
        $this->req('PATCH', "$base/events/{$ids[2]}", $auth, ['name' => 'Sonder', 'timeEnd' => '22:00']);

        $r = $this->req('PATCH', "$base/events/{$ids[1]}", $auth, [
            'scope' => 'all', 'date' => '2026-10-16', 'timeBegin' => '18:30', 'locationId' => $loc,
            'targetGroupIds' => [$group, $group], 'featureIds' => [$feature], 'isDraft' => false,
        ]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('2026-10-16', $r['body']['date']);
        self::$em->clear();

        $events = array_column($this->req('GET', "$base/events", $auth)['body'], null, 'id');
        $this->assertSame(['2026-10-08', '2026-10-16', '2026-10-22', '2026-10-29'], array_map(fn ($id) => $events[$id]['date'], $ids), 'the date changes only for the edited event');
        foreach ($ids as $id) {
            $e = $events[$id];
            $this->assertSame(['18:30', $loc, false], [$e['timeBegin'], $e['locationId'], $e['isDraft']], $id);
            $this->assertSame([$group], array_column($e['targetGroups'], 'targetGroupId'));
            $this->assertSame([$feature], array_column($e['features'], 'featureId'));
        }
        // Fields not sent stay as they were, also the individually edited ones
        $this->assertSame(['Sonder', '22:00'], [$events[$ids[2]]['name'], $events[$ids[2]]['timeEnd']]);
        $this->assertSame(['Training', '21:00'], [$events[$ids[0]]['name'], $events[$ids[0]]['timeEnd']]);
        // Events outside the series are untouched
        $this->assertSame(['Einzeln', '18:00', null], [$events[$single->getId()]['name'], $events[$single->getId()]['timeBegin'], $events[$single->getId()]['locationId']]);

        // Unchanged assignments can be sent again (no identity collision), name for all
        $r = $this->req('PATCH', "$base/events/{$ids[0]}", $auth, ['scope' => 'all', 'name' => 'Training neu', 'targetGroupIds' => [$group], 'isAllDay' => true, 'timeBegin' => '00:00', 'timeEnd' => '23:59']);
        $this->assertSame(200, $r['status'], $r['content']);
        self::$em->clear();
        foreach ($this->req('GET', "$base/events", $auth)['body'] as $e) {
            if ($e['seriesId']) {
                $this->assertSame(['Training neu', true], [$e['name'], $e['isAllDay']]);
            }
        }
    }

    public function testEditingAllIsAtomic(): void
    {
        [$auth, $base] = $this->setupCalendar();
        [$otherAuth, $otherBase] = $this->setupCalendar();
        $foreign = $this->req('POST', "$otherBase/target-groups", $otherAuth, ['name' => 'Fremd'])['body']['id'];
        $series = $this->createSeries($base, $auth);
        $ids = array_column($series['events'], 'id');

        $r = $this->req('PATCH', "$base/events/{$ids[0]}", $auth, ['scope' => 'all', 'name' => 'Neu', 'targetGroupIds' => [$foreign]]);
        $this->assertSame(422, $r['status']);
        $r = $this->req('PATCH', "$base/events/{$ids[0]}", $auth, ['scope' => 'all', 'name' => '   ']);
        $this->assertSame(400, $r['status']);
        self::$em->clear();
        foreach ($this->req('GET', "$base/events", $auth)['body'] as $e) {
            $this->assertSame('Training', $e['name']);
        }
    }

    public function testEditingAllWithoutSeriesChangesOnlyThisEvent(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $a = TestHelper::createEvent(self::$em, $cal, ['name' => 'A']);
        $b = TestHelper::createEvent(self::$em, $cal, ['name' => 'B']);

        $r = $this->req('PATCH', "$base/events/{$a->getId()}", $auth, ['scope' => 'all', 'name' => 'A2']);
        $this->assertSame(200, $r['status']);
        $this->assertArrayHasKey('seriesId', $r['body']);
        $this->assertNull($r['body']['seriesId']);
        self::$em->clear();
        $b = $this->req('GET', "$base/events/{$b->getId()}", $auth)['body'];
        $this->assertSame('B', $b['name']);
        $this->assertArrayHasKey('series', $b);
        $this->assertNull($b['series']);
    }

    public function testEditingAllRunsTheSameNumberOfQueriesForLongerSeries(): void
    {
        [$auth, $base] = $this->setupCalendar();
        $group = $this->req('POST', "$base/target-groups", $auth, ['name' => 'Jugend'])['body']['id'];
        $prop = $this->req('POST', "$base/properties", $auth, ['name' => 'Draußen'])['body']['id'];
        $short = $this->createSeries($base, $auth, ['event' => ['name' => 'Kurz', 'isAllDay' => true, 'propertyIds' => [$prop]]]);
        $long = $this->createSeries($base, $auth, ['rule' => $this->rule(['until' => '2026-12-31']), 'event' => ['name' => 'Lang', 'isAllDay' => true, 'propertyIds' => [$prop]]]);
        $this->assertCount(13, $long['events']);
        self::$em->clear();

        QueryCounter::$count = 0;
        $this->req('PATCH', "$base/events/{$short['events'][0]['id']}", $auth, ['scope' => 'all', 'name' => 'K', 'targetGroupIds' => [$group], 'propertyIds' => []]);
        $shortQueries = QueryCounter::$count;
        self::$em->clear();

        QueryCounter::$count = 0;
        $this->req('PATCH', "$base/events/{$long['events'][0]['id']}", $auth, ['scope' => 'all', 'name' => 'L', 'targetGroupIds' => [$group], 'propertyIds' => []]);
        // Reads are constant; writes are one statement per changed row (Doctrine's unit of work)
        $extraRows = (13 - 4) * 3; // per extra event: UPDATE name, INSERT target group, DELETE property
        $this->assertLessThanOrEqual($shortQueries + $extraRows, QueryCounter::$count, 'no read query per event');
    }

    // ---- Deleting with scope ----------------------------------------------------------------------

    public function testDeletingOneEventKeepsTheSeriesUntilTheLastOne(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $seriesId = $series['series']['id'];
        $ids = array_column($series['events'], 'id');

        $this->assertSame(200, $this->req('DELETE', "$base/events/{$ids[0]}", $auth)['status']);
        $this->assertSame(200, $this->req('DELETE', "$base/events/{$ids[1]}?scope=this", $auth)['status']);
        self::$em->clear();
        $this->assertSame(2, $this->req('GET', "$base/event-series/$seriesId", $auth)['body']['eventCount']);
        $this->assertSame(400, $this->req('DELETE', "$base/events/{$ids[2]}?scope=every", $auth)['status']);

        $this->req('DELETE', "$base/events/{$ids[2]}", $auth);
        $this->req('DELETE', "$base/events/{$ids[3]}", $auth);
        self::$em->clear();
        $this->assertSame(404, $this->req('GET', "$base/event-series/$seriesId", $auth)['status'], 'a series without events is removed');
        $this->assertSame(0, $this->countRows('event_series', $cal->getId()));
    }

    public function testDeletingAllEventsRemovesTheSeriesAndNothingElse(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $series = $this->createSeries($base, $auth);
        $other = $this->createSeries($base, $auth);
        $single = TestHelper::createEvent(self::$em, $cal);

        $r = $this->req('DELETE', "$base/events/{$series['events'][2]['id']}?scope=all", $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        self::$em->clear();
        $left = array_column($this->req('GET', "$base/events", $auth)['body'], 'id');
        $this->assertCount(5, $left);
        $this->assertContains($single->getId(), $left);
        $this->assertSame(404, $this->req('GET', "$base/event-series/{$series['series']['id']}", $auth)['status']);
        $this->assertSame(4, $this->req('GET', "$base/event-series/{$other['series']['id']}", $auth)['body']['eventCount']);

        // "all" on an event without series deletes just that event
        $this->assertSame(200, $this->req('DELETE', "$base/events/{$single->getId()}?scope=all", $auth)['status']);
        $this->assertSame(4, $this->countRows('event', $cal->getId()));
    }

    public function testBulkDeleteRemovesSeriesWithoutEvents(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $partly = $this->createSeries($base, $auth);
        $fully = $this->createSeries($base, $auth);
        $ids = array_merge(array_slice(array_column($partly['events'], 'id'), 0, 2), array_column($fully['events'], 'id'));

        $r = $this->req('POST', "$base/events/bulk", $auth, ['ids' => $ids, 'action' => 'delete']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(6, $r['body']['affected']);
        self::$em->clear();
        $this->assertSame(2, $this->req('GET', "$base/event-series/{$partly['series']['id']}", $auth)['body']['eventCount']);
        $this->assertSame(404, $this->req('GET', "$base/event-series/{$fully['series']['id']}", $auth)['status']);
        $this->assertSame(1, $this->countRows('event_series', $cal->getId()));

        // Publishing in bulk keeps the series
        $this->assertSame(200, $this->req('POST', "$base/events/bulk", $auth, ['ids' => array_slice(array_column($partly['events'], 'id'), 2), 'action' => 'publish'])['status']);
        $this->assertSame(1, $this->countRows('event_series', $cal->getId()));
    }

    // ---- Clean-up with templates, calendars, clubs --------------------------------------------------

    public function testDeletingTheTemplateKeepsSeriesAndEvents(): void
    {
        [$auth, $base, $cal] = $this->setupCalendar();
        $tpl = $this->req('POST', "$base/templates", $auth, ['name' => 'Vorlage', 'timeBegin' => '19:00', 'timeEnd' => '20:00'])['body']['id'];
        $series = $this->req('POST', "$base/events/series", $auth, ['rule' => $this->rule(), 'templateId' => $tpl])['body'];

        $this->assertSame(200, $this->req('DELETE', "$base/templates/$tpl", $auth)['status']);
        self::$em->clear();
        $get = $this->req('GET', "$base/event-series/{$series['series']['id']}", $auth);
        $this->assertSame(200, $get['status']);
        $this->assertNull($get['body']['templateId']);
        $this->assertSame(4, $get['body']['eventCount']);
        $this->assertSame(4, $this->countRows('event', $cal->getId()));
    }

    public function testDeletingCalendarOrClubRemovesItsSeries(): void
    {
        [$auth, $base, $cal, $clubId] = $this->setupCalendar();
        $this->createSeries($base, $auth);
        $second = TestHelper::createCalendar(self::$em, self::$em->find(Calendar::class, $cal->getId())->getClub(), 'Zweiter');
        $this->createSeries("/api/calendars/{$second->getId()}", $auth);

        $this->assertSame(200, $this->req('DELETE', "/api/clubs/$clubId/calendars/{$cal->getId()}", $auth)['status']);
        $this->assertSame(0, $this->countRows('event_series', $cal->getId()));
        $this->assertSame(1, $this->countRows('event_series', $second->getId()));

        $this->assertSame(200, $this->req('DELETE', "/api/clubs/$clubId", $auth)['status']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM event_series'));
    }

    public function testDuplicatingACalendarCopiesNeitherEventsNorSeries(): void
    {
        [$auth, $base, $cal, $clubId] = $this->setupCalendar();
        $this->createSeries($base, $auth);

        $copy = $this->req('POST', "/api/clubs/$clubId/calendars/{$cal->getId()}/duplicate", $auth, ['name' => 'Kopie']);
        $this->assertSame(201, $copy['status']);
        $this->assertSame(0, $copy['body']['eventCount']);
        $this->assertSame(0, $this->countRows('event_series', $copy['body']['id']));
        $this->assertSame(1, $this->countRows('event_series', $cal->getId()));
    }
}
