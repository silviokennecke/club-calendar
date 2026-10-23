<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\User;
use App\Enum\FeedVisibility;
use App\Service\CalendarVersionBumper;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** calendar.content_version changes with every change of a calendar's feed output and only then. */
class ContentVersionTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $user;
    private Club $club;
    private Calendar $cal;
    private Calendar $cal2;
    private Club $otherClub;
    private Calendar $otherCal;
    private string $auth;

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
        ['user' => $this->user, 'club' => $this->club, 'calendar' => $this->cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $this->cal2 = TestHelper::createCalendar(self::$em, $this->club, 'Second');
        $this->otherClub = TestHelper::createClub(self::$em, $this->user, 'Other');
        $this->otherCal = TestHelper::createCalendar(self::$em, $this->otherClub, 'Other cal');
        $this->auth = TestHelper::authHeader($this->user, self::$tokens);
    }

    private function v(Calendar $c): string
    {
        return (string) self::$em->getConnection()->fetchOne('SELECT content_version FROM calendar WHERE id = ?', [$c->getId()]);
    }

    /** @return array{string, string, string} */
    private function snapshot(): array
    {
        return [$this->v($this->cal), $this->v($this->cal2), $this->v($this->otherCal)];
    }

    /** Runs $action and asserts which of [cal, cal2, otherCal] changed. */
    private function assertBumps(array $expected, callable $action, string $msg = ''): void
    {
        $before = $this->snapshot();
        $action();
        $after = $this->snapshot();
        foreach ($expected as $i => $changed) {
            $this->assertSame($changed, $before[$i] !== $after[$i], sprintf('%s calendar #%d %s', $msg, $i, $changed ? 'should change' : 'must stay'));
        }
    }

    private function api(string $method, string $uri, array $data = []): array
    {
        $r = TestHelper::jsonRequest(self::$client, $method, $uri, $data, $this->auth);
        self::$em->clear();
        $this->assertLessThan(300, $r['status'], $r['content']);

        return $r;
    }

    private function base(Calendar $c): string
    {
        return '/api/calendars/'.$c->getId();
    }

    private function clubBase(): string
    {
        return '/api/clubs/'.$this->club->getId();
    }

    private function eventData(array $o = []): array
    {
        return $o + ['name' => 'E', 'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'isDraft' => false];
    }

    private function mkEvent(array $o = []): string
    {
        return $this->api('POST', $this->base($this->cal).'/events', $this->eventData($o))['body']['id'];
    }

    public function testNewCalendarGetsUniqueUuidV7(): void
    {
        $this->assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $this->v($this->cal));
        $this->assertNotSame($this->v($this->cal), $this->v($this->cal2));
        $this->assertSame($this->v($this->cal), self::$em->find(Calendar::class, $this->cal->getId())->getContentVersion());
    }

    public function testReadsDoNotChangeTheToken(): void
    {
        $this->mkEvent();
        $this->assertBumps([false, false, false], function (): void {
            $this->api('GET', $this->base($this->cal).'/events');
            $this->api('GET', $this->base($this->cal).'/events.ics');
            $this->api('GET', $this->clubBase().'/calendars');
        });
    }

    public function testEventCreateUpdateDraftAndDelete(): void
    {
        $id = null;
        $this->assertBumps([true, false, false], function () use (&$id): void { $id = $this->mkEvent(); }, 'create');
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal)."/events/$id", ['name' => 'Renamed']), 'rename');
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal)."/events/$id", ['isDraft' => true]), 'draft');
        $this->assertBumps([true, false, false], fn () => $this->api('DELETE', $this->base($this->cal)."/events/$id"), 'delete');
    }

    public function testBulkActionsAndImport(): void
    {
        $a = $this->mkEvent();
        $b = $this->mkEvent(['date' => '2026-10-02']);
        $this->assertBumps([true, false, false], fn () => $this->api('POST', $this->base($this->cal).'/events/bulk', ['ids' => [$a, $b], 'action' => 'draft']), 'bulk draft');
        $this->assertBumps([true, false, false], fn () => $this->api('POST', $this->base($this->cal).'/events/bulk', ['ids' => [$a], 'action' => 'publish']), 'bulk publish');
        $this->assertBumps([true, false, false], fn () => $this->api('POST', $this->base($this->cal).'/events/bulk', ['ids' => [$a, $b], 'action' => 'delete']), 'bulk delete');
        $this->assertBumps([false, false, false], fn () => $this->api('POST', $this->base($this->cal).'/events/import/preview', ['events' => [$this->eventData()]]), 'preview');
        $this->assertBumps([true, false, false], fn () => $this->api('POST', $this->base($this->cal).'/events/import', ['events' => [$this->eventData()]]), 'import');
    }

    public function testSeriesCreateChangeAndDelete(): void
    {
        $rule = ['frequency' => 'weekly', 'weekday' => 4, 'startDate' => '2099-10-01', 'until' => '2099-11-26', 'skipHolidays' => false];
        $series = null;
        $this->assertBumps([true, false, false], function () use (&$series, $rule): void {
            $series = $this->api('POST', $this->base($this->cal).'/events/series', ['rule' => $rule, 'event' => ['name' => 'T', 'timeBegin' => '19:00', 'timeEnd' => '21:00']])['body'];
        }, 'create');
        $sid = $series['series']['id'];
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal)."/event-series/$sid", ['rule' => $rule + ['until' => '2099-11-12'] + []]), 'rule change');
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal).'/events/'.$series['events'][0]['id'], ['name' => 'X', 'scope' => 'all']), 'scope all');
        $this->assertBumps([true, false, false], fn () => $this->api('DELETE', $this->base($this->cal).'/events/'.$series['events'][0]['id'].'?scope=all'), 'delete all');
    }

    public function testPropertyFeatureAssignmentRenameAndDelete(): void
    {
        $prop = $this->api('POST', $this->base($this->cal).'/properties', ['name' => 'P', 'icon' => 'a'])['body']['id'];
        $feat = $this->api('POST', $this->base($this->cal).'/features', ['name' => 'F'])['body']['id'];
        $id = $this->mkEvent();
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal)."/events/$id", ['propertyIds' => [$prop], 'featureIds' => [$feat]]), 'assign');
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal)."/properties/$prop", ['icon' => 'b']), 'icon');
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->base($this->cal)."/features/$feat", ['name' => 'F2']), 'feature rename');
        $this->assertBumps([true, false, false], fn () => $this->api('DELETE', $this->base($this->cal)."/properties/$prop"), 'delete property (DB cascade)');
        $this->assertBumps([true, false, false], fn () => $this->api('DELETE', $this->base($this->cal)."/features/$feat"), 'delete feature');
    }

    public function testNewUnassignedReferenceDataDoesNotBump(): void
    {
        $this->assertBumps([false, false, false], function (): void {
            $this->api('POST', $this->base($this->cal).'/properties', ['name' => 'P']);
            $this->api('POST', $this->clubBase().'/target-groups', ['name' => 'TG']);
            $this->api('POST', $this->clubBase().'/locations', ['name' => 'L']);
        });
    }

    public function testTargetGroupChangesBumpAllCalendarsOfTheClubOnly(): void
    {
        $tg = $this->api('POST', $this->clubBase().'/target-groups', ['name' => 'TG'])['body']['id'];
        $this->assertBumps([true, true, false], fn () => $this->api('PATCH', $this->clubBase()."/target-groups/$tg", ['name' => 'TG2']), 'rename');
        $id = $this->mkEvent(['targetGroupIds' => [$tg]]);
        $this->assertBumps([true, true, false], fn () => $this->api('DELETE', $this->clubBase()."/target-groups/$tg"), 'delete');
        $this->assertNotNull($id);
    }

    public function testLocationChangesBumpAllCalendarsOfTheClubOnly(): void
    {
        $loc = $this->api('POST', $this->clubBase().'/locations', ['name' => 'L'])['body']['id'];
        $this->mkEvent(['locationId' => $loc]);
        $this->assertBumps([true, true, false], fn () => $this->api('PATCH', $this->clubBase()."/locations/$loc", ['name' => 'L2']), 'rename');
        $this->assertBumps([true, true, false], fn () => $this->api('DELETE', $this->clubBase()."/locations/$loc"), 'delete (SET NULL)');
    }

    public function testCalendarOwnChanges(): void
    {
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->clubBase().'/calendars/'.$this->cal->getId(), ['name' => 'N']), 'name');
        $this->assertBumps([true, false, false], fn () => $this->api('PATCH', $this->clubBase().'/calendars/'.$this->cal->getId(), ['timezone' => 'Europe/London']), 'zone');
        $this->assertBumps([true, false, false], fn () => $this->api('POST', $this->clubBase().'/calendars/'.$this->cal->getId().'/archive'), 'archive');
        $this->assertBumps([true, false, false], fn () => $this->api('POST', $this->clubBase().'/calendars/'.$this->cal->getId().'/unarchive'), 'unarchive');
    }

    public function testClubTimezoneBumpsAllClubCalendarsButNameDoesNot(): void
    {
        $this->assertBumps([false, false, false], fn () => $this->api('PATCH', $this->clubBase(), ['name' => 'Renamed club']), 'name');
        $this->assertBumps([true, true, false], fn () => $this->api('PATCH', $this->clubBase(), ['timezone' => 'Europe/London']), 'timezone');
    }

    public function testMovingAnEventBumpsOldAndNewCalendar(): void
    {
        $event = TestHelper::createEvent(self::$em, $this->cal);
        $before = $this->snapshot();
        $event->setCalendar($this->cal2);
        self::$em->flush();
        $after = $this->snapshot();
        $this->assertNotSame($before[0], $after[0]);
        $this->assertNotSame($before[1], $after[1]);
        $this->assertSame($before[2], $after[2]);
    }

    public function testHolidaysBump(): void
    {
        $hc = new HolidayCalendar($this->cal, 'H', 'https://example.com/h.ics');
        self::$em->persist($hc);
        self::$em->flush();
        $this->assertBumps([true, false, false], function () use ($hc): void {
            self::$em->persist(new HolidayEvent($hc, 'u1', 'Day', new \DateTimeImmutable('2026-12-25'), null));
            self::$em->flush();
        }, 'holiday event');
        $this->assertBumps([true, false, false], function () use ($hc): void {
            $hc->setName('H2');
            self::$em->flush();
        }, 'holiday calendar');
        $this->assertBumps([true, false, false], fn () => $this->api('DELETE', $this->base($this->cal).'/holiday-calendars/'.$hc->getId()), 'delete holiday calendar');
    }

    public function testBumperBulkHelpers(): void
    {
        $bumper = new CalendarVersionBumper(self::$em->getConnection());
        $this->assertBumps([true, false, false], fn () => $bumper->bumpCalendars([$this->cal->getId()]));
        $this->assertBumps([true, true, false], fn () => $bumper->bumpClub($this->club->getId()));
        $this->assertBumps([false, false, false], fn () => $bumper->bumpCalendars([]));
    }

    public function testRolledBackTransactionKeepsTheToken(): void
    {
        $this->assertBumps([false, false, false], function (): void {
            try {
                self::$em->wrapInTransaction(function (): void {
                    $c = self::$em->find(Calendar::class, $this->cal->getId());
                    $c->setName('X');
                    self::$em->flush();
                    throw new \RuntimeException('rollback');
                });
            } catch (\RuntimeException) {
            }
        });
    }

    public function testChangeInAnotherClubLeavesTheTokensAlone(): void
    {
        $this->assertBumps([false, false, true], function (): void {
            $this->api('POST', '/api/calendars/'.$this->otherCal->getId().'/events', $this->eventData());
        });
    }

    public function testFeedConfigurationChangesStampTheFeed(): void
    {
        $feed = TestHelper::createFeed(self::$em, $this->club, [$this->cal], FeedVisibility::CLUB);
        $tg = TestHelper::createTargetGroup(self::$em, $this->club);
        $feedId = $feed->getId();
        $stamp = fn (): string => (string) self::$em->getConnection()->fetchOne('SELECT updated_at FROM calendar_feed WHERE id = ?', [$feedId]);
        $changes = [
            'calendars' => ['calendarIds' => [$this->cal->getId(), $this->cal2->getId()]],
            'target groups' => ['targetGroupIds' => [$tg->getId()]],
            'visibility' => ['visibility' => 'PUBLIC'],
        ];
        foreach ($changes as $label => $payload) {
            self::$em->getConnection()->executeStatement('UPDATE calendar_feed SET updated_at = ? WHERE id = ?', ['2000-01-01 00:00:00', $feedId]);
            $this->api('PATCH', $this->clubBase()."/feeds/$feedId", $payload);
            $this->assertNotSame('2000-01-01 00:00:00', $stamp(), $label);
        }
        self::$em->getConnection()->executeStatement('UPDATE calendar_feed SET updated_at = ? WHERE id = ?', ['2000-01-01 00:00:00', $feedId]);
        $this->api('POST', $this->clubBase()."/feeds/$feedId/regenerate-secret");
        $this->assertNotSame('2000-01-01 00:00:00', $stamp(), 'secret');
        self::$em->getConnection()->executeStatement('UPDATE calendar_feed SET updated_at = ? WHERE id = ?', ['2000-01-01 00:00:00', $feedId]);
        $this->api('PATCH', $this->clubBase()."/feeds/$feedId", ['visibility' => 'PRIVATE']);
        $this->assertNotSame('2000-01-01 00:00:00', $stamp(), 'private (new secret)');
    }

    public function testDeletingACalendarStampsFeedsThatKeepOtherCalendars(): void
    {
        $feed = TestHelper::createFeed(self::$em, $this->club, [$this->cal, $this->cal2]);
        $feedId = $feed->getId();
        self::$em->getConnection()->executeStatement('UPDATE calendar_feed SET updated_at = ? WHERE id = ?', ['2000-01-01 00:00:00', $feedId]);
        $this->api('DELETE', $this->clubBase().'/calendars/'.$this->cal->getId());
        $this->assertNotSame('2000-01-01 00:00:00', (string) self::$em->getConnection()->fetchOne('SELECT updated_at FROM calendar_feed WHERE id = ?', [$feedId]));
        $this->assertSame(1, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM calendar_feed_calendar WHERE feed_id = ?', [$feedId]));
    }
}
