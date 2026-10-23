<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Migrations\Version20261020120000;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\Exception\AbortMigration;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

require_once dirname(__DIR__, 2).'/migrations/Version20261020120000.php';

/**
 * Locations, target groups and feeds (properties and features stay calendar-level) move from calendar to club scope; a feed selects
 * calendars through calendar_feed_calendar. Runs the migration's SQL on the test database and always leaves
 * it migrated.
 */
class ClubScopeMigrationTest extends WebTestCase
{
    private const REFERENCE_TABLES = ['location', 'target_group'];

    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;

    public static function setUpBeforeClass(): void
    {
        static::createClient();
        self::$hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
        if (!$this->hasClubId('location')) {
            $this->clearScopedRows();
            $this->migrate('up');
        }
        DatabaseResetter::reset(self::$em);
    }

    private function conn(): Connection
    {
        return self::$em->getConnection();
    }

    private function migration(): Version20261020120000
    {
        return new Version20261020120000($this->conn(), new NullLogger());
    }

    private function migrate(string $direction): void
    {
        $migration = $this->migration();
        if ('down' === $direction) {
            $migration->preDown(new Schema());
        }
        $migration->{$direction}(new Schema());
        foreach ($migration->getSql() as $query) {
            $this->conn()->executeStatement($query->getStatement(), $query->getParameters(), $query->getTypes());
        }
    }

    private function hasClubId(string $table): bool
    {
        return (bool) $this->conn()->fetchOne(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'club_id'",
            [$table],
        );
    }

    private function clearScopedRows(): void
    {
        foreach (['calendar_feed_target_group', 'event_target_group', 'event_template_target_group', 'calendar_feed', 'location', 'target_group'] as $table) {
            $this->conn()->executeStatement("DELETE FROM $table");
        }
    }

    /**
     * Club with two calendars, an event and a template each. Returns the ids; leaves the schema in the OLD shape
     * (calendar_id) with one location/target group/feed per calendar, referenced by that
     * calendar's event and template.
     *
     * @return array<string, mixed>
     */
    private function seedOldShape(): array
    {
        ['club' => $club, 'calendar' => $cal1] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $cal2 = TestHelper::createCalendar(self::$em, $club, 'Second');
        $ids = ['club' => $club->getId(), 'cal' => [$cal1->getId(), $cal2->getId()], 'event' => [], 'template' => []];
        foreach ([$cal1, $cal2] as $i => $cal) {
            $ids['event'][$i] = TestHelper::createEvent(self::$em, $cal, ['name' => "E$i"])->getId();
            $ids['template'][$i] = TestHelper::createTemplate(self::$em, $cal, ['name' => "T$i"])->getId();
        }

        $this->migrate('down');
        foreach ([0, 1] as $i) {
            $cal = $ids['cal'][$i];
            $loc = sprintf('00000000-0000-7000-8000-0000000001%02d', $i);
            $tg = sprintf('00000000-0000-7000-8000-0000000004%02d', $i);
            $feed = sprintf('00000000-0000-7000-8000-0000000005%02d', $i);
            $this->conn()->insert('location', ['id' => $loc, 'calendar_id' => $cal, 'name' => "Loc$i", 'updated_at' => '2026-01-01 00:00:00']);
            $this->conn()->insert('target_group', ['id' => $tg, 'calendar_id' => $cal, 'name' => "TG$i", 'updated_at' => '2026-01-01 00:00:00']);
            $this->conn()->insert('calendar_feed', ['id' => $feed, 'calendar_id' => $cal, 'name' => "Feed$i", 'updated_at' => '2026-01-01 00:00:00', 'visibility' => 'PRIVATE', 'shared_secret' => "secret-value-$i"]);
            $this->conn()->insert('calendar_feed_target_group', ['feed_id' => $feed, 'target_group_id' => $tg]);
            foreach (['event' => 'event_id', 'event_template' => 'template_id'] as $owner => $col) {
                $key = 'event' === $owner ? 'event' : 'template';
                $oid = $ids[$key][$i];
                $this->conn()->update($owner, ['location_id' => $loc], ['id' => $oid]);
                $prefix = 'event' === $owner ? 'event' : 'event_template';
                $this->conn()->insert("{$prefix}_target_group", [$col => $oid, 'target_group_id' => $tg]);
            }
            $ids['ref'][$i] = compact('loc', 'tg', 'feed');
        }

        return $ids;
    }

    public function testUpMovesRowsToTheClubAndKeepsFeedsAndReferences(): void
    {
        $ids = $this->seedOldShape();
        $feedsBefore = $this->conn()->fetchAllAssociative('SELECT id, name, visibility, shared_secret FROM calendar_feed ORDER BY id');

        $this->migrate('up');

        foreach (self::REFERENCE_TABLES as $table) {
            $this->assertSame([$ids['club'], $ids['club']], $this->conn()->fetchFirstColumn("SELECT club_id FROM $table ORDER BY id"), $table);
            $this->assertFalse((bool) $this->conn()->fetchOne("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '$table' AND column_name = 'calendar_id'"), "$table.calendar_id dropped");
        }
        $this->assertSame([$ids['club'], $ids['club']], $this->conn()->fetchFirstColumn('SELECT club_id FROM calendar_feed ORDER BY id'));
        $this->assertSame($feedsBefore, $this->conn()->fetchAllAssociative('SELECT id, name, visibility, shared_secret FROM calendar_feed ORDER BY id'), 'feed ids, secrets, names unchanged');
        $this->assertSame(
            [[$ids['ref'][0]['feed'], $ids['cal'][0]], [$ids['ref'][1]['feed'], $ids['cal'][1]]],
            array_map('array_values', $this->conn()->fetchAllAssociative('SELECT feed_id, calendar_id FROM calendar_feed_calendar ORDER BY feed_id')),
            'each feed has exactly its one old calendar',
        );
        $this->assertSame(2, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM calendar_feed_target_group'));

        foreach ([0, 1] as $i) {
            $ref = $ids['ref'][$i];
            $this->assertSame([$ref['loc'], $ids['cal'][$i]], array_values($this->conn()->fetchAssociative('SELECT location_id, calendar_id FROM event WHERE id = ?', [$ids['event'][$i]])));
            $this->assertSame([$ref['loc'], $ids['cal'][$i]], array_values($this->conn()->fetchAssociative('SELECT location_id, calendar_id FROM event_template WHERE id = ?', [$ids['template'][$i]])));
            $this->assertSame($ref['tg'], $this->conn()->fetchOne('SELECT target_group_id FROM event_target_group WHERE event_id = ?', [$ids['event'][$i]]));
        }
    }

    public function testDownAbortsForAFeedWithSeveralCalendars(): void
    {
        $ids = $this->seedOldShape();
        $this->migrate('up');
        $this->conn()->insert('calendar_feed_calendar', ['feed_id' => $ids['ref'][0]['feed'], 'calendar_id' => $ids['cal'][1]]);

        try {
            $this->migration()->preDown(new Schema());
            $this->fail('down must abort');
        } catch (AbortMigration $e) {
            $this->assertStringContainsString('more than one calendar', $e->getMessage());
        }
        $this->assertTrue($this->hasClubId('location'), 'schema untouched');
    }

    public function testDownAbortsWhenAReferenceRowIsUsedByDifferentCalendars(): void
    {
        $ids = $this->seedOldShape();
        $this->migrate('up');
        // Event of calendar 2 now also uses calendar 1's location
        $this->conn()->update('event', ['location_id' => $ids['ref'][0]['loc']], ['id' => $ids['event'][1]]);

        try {
            $this->migration()->preDown(new Schema());
            $this->fail('down must abort');
        } catch (AbortMigration $e) {
            $this->assertStringContainsString('different calendars', $e->getMessage());
        }
    }

    public function testDownRestoresCalendarIdsAndUpAgainRoundTrips(): void
    {
        $ids = $this->seedOldShape();
        $this->migrate('up');
        // An unused location and a second, unused feed calendar-less row go to the club's smallest calendar id
        $unused = '00000000-0000-7000-8000-000000000999';
        $this->conn()->insert('location', ['id' => $unused, 'club_id' => $ids['club'], 'name' => 'Unused', 'updated_at' => '2026-01-01 00:00:00']);

        $this->migrate('down');

        foreach ([0, 1] as $i) {
            $ref = $ids['ref'][$i];
            foreach (['location' => 'loc', 'target_group' => 'tg', 'calendar_feed' => 'feed'] as $table => $key) {
                $this->assertSame($ids['cal'][$i], $this->conn()->fetchOne("SELECT calendar_id FROM $table WHERE id = ?", [$ref[$key]]), "$table $i");
            }
        }
        $this->assertSame(min($ids['cal']), $this->conn()->fetchOne('SELECT calendar_id FROM location WHERE id = ?', [$unused]));
        $this->assertFalse($this->hasClubId('location'));
        $this->assertSame(0, (int) $this->conn()->fetchOne("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'calendar_feed_calendar'"));

        $this->migrate('up');
        $this->assertSame(2, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM calendar_feed_calendar'));
        $this->assertSame([$ids['club']], array_unique($this->conn()->fetchFirstColumn('SELECT club_id FROM location')));
    }
}
