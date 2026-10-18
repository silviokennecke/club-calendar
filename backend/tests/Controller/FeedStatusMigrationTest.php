<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Migrations\Version20261015120000;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

require_once dirname(__DIR__, 2).'/migrations/Version20261015120000.php';

/**
 * Migration to three feed states with existing data: PUBLIC feeds become CLUB (reachable by link, not
 * indexed), PRIVATE feeds stay PRIVATE and keep requiring their secret; down maps CLUB back to PUBLIC
 * and drops `searchable`. Runs the migration's SQL on the test database and always leaves it migrated.
 */
class FeedStatusMigrationTest extends WebTestCase
{
    private const PUBLIC_SECRET = 'test-secret-value-public';
    private const PRIVATE_SECRET = 'test-secret-value-private';

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

    protected function tearDown(): void
    {
        // Leave the schema migrated, whatever happened in the test
        if (!$this->hasSearchableColumn()) {
            $this->migrate('up');
        }
        DatabaseResetter::reset(self::$em);
    }

    private function conn(): Connection
    {
        return self::$em->getConnection();
    }

    private function migrate(string $direction): void
    {
        $migration = new Version20261015120000($this->conn(), new NullLogger());
        $migration->{$direction}(new Schema());
        foreach ($migration->getSql() as $query) {
            $this->conn()->executeStatement($query->getStatement(), $query->getParameters(), $query->getTypes());
        }
    }

    private function hasSearchableColumn(): bool
    {
        return (bool) $this->conn()->fetchOne(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'calendar_feed' AND column_name = 'searchable'",
        );
    }

    private function visibilityDefault(): ?string
    {
        $default = $this->conn()->fetchOne(
            "SELECT column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'calendar_feed' AND column_name = 'visibility'",
        );

        return is_string($default) ? trim($default, "'") : null;
    }

    /** @return array<string, string> feed id => visibility */
    private function visibilities(): array
    {
        return $this->conn()->fetchAllKeyValue('SELECT id, visibility FROM calendar_feed ORDER BY id');
    }

    /** A feed of the calendar: owned by the calendar's club and linked through `calendar_feed_calendar`. */
    private function insertFeed(string $id, string $calendarId, string $visibility, string $secret, ?string $name = null): void
    {
        $this->conn()->insert('calendar_feed', [
            'id' => $id, 'club_id' => $this->clubOf($calendarId), 'name' => $name ?? "Feed $visibility", 'visibility' => $visibility, 'shared_secret' => $secret,
        ]);
        $this->conn()->insert('calendar_feed_calendar', ['feed_id' => $id, 'calendar_id' => $calendarId]);
    }

    private function clubOf(string $calendarId): string
    {
        return (string) $this->conn()->fetchOne('SELECT club_id FROM calendar WHERE id = ?', [$calendarId]);
    }

    public function testExistingPublicFeedsBecomeClubAndPrivateFeedsKeepTheirSecret(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        TestHelper::createEvent(self::$em, $cal, ['name' => 'Königsschießen', 'isDraft' => false]);
        $calId = $cal->getId();

        // State before the migration: two states, no searchable column
        $this->migrate('down');
        $this->assertFalse($this->hasSearchableColumn());
        $this->assertSame('PRIVATE', $this->visibilityDefault());
        $public = '00000000-0000-7000-8000-000000000001';
        $private = '00000000-0000-7000-8000-000000000002';
        $this->insertFeed($public, $calId, 'PUBLIC', self::PUBLIC_SECRET);
        $this->insertFeed($private, $calId, 'PRIVATE', self::PRIVATE_SECRET);

        $this->migrate('up');

        $this->assertTrue($this->hasSearchableColumn());
        $this->assertSame([$public => 'CLUB', $private => 'PRIVATE'], $this->visibilities());
        $this->assertSame([0, 0], array_map('intval', $this->conn()->fetchFirstColumn('SELECT searchable FROM calendar_feed')));
        $this->assertSame('CLUB', $this->visibilityDefault());
        $this->assertSame(
            [self::PUBLIC_SECRET, self::PRIVATE_SECRET],
            $this->conn()->fetchFirstColumn('SELECT shared_secret FROM calendar_feed ORDER BY id'),
            'secrets unchanged',
        );
        // A row inserted without values gets the new defaults
        $this->conn()->executeStatement("INSERT INTO calendar_feed (id, club_id, name, shared_secret) VALUES ('00000000-0000-7000-8000-000000000003', ?, 'Neu', 'test-secret-value-new')", [$this->clubOf($calId)]);
        $this->assertSame(['CLUB', '0'], array_map('strval', array_values($this->conn()->fetchAssociative("SELECT visibility, searchable FROM calendar_feed WHERE name = 'Neu'"))));

        self::$em->clear();
        // Formerly public: still reachable without a secret, now as CLUB and noindex
        foreach (["/api/feed/$public/events", "/api/feed/$public/ics"] as $uri) {
            self::$client->request('GET', $uri);
            $this->assertSame(200, self::$client->getResponse()->getStatusCode(), $uri);
            $this->assertSame('noindex', self::$client->getResponse()->headers->get('X-Robots-Tag'), $uri);
        }
        self::$client->request('GET', "/api/feed/$public/events");
        $body = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertSame(['CLUB', false], [$body['feed']['visibility'], $body['feed']['indexable']]);

        // Formerly private: the secret is still required
        foreach (["/api/feed/$private/events", "/api/feed/$private/ics"] as $uri) {
            self::$client->request('GET', $uri);
            $this->assertSame(403, self::$client->getResponse()->getStatusCode(), $uri);
            self::$client->request('GET', "$uri?secret=wrong-secret");
            $this->assertSame(403, self::$client->getResponse()->getStatusCode(), "$uri wrong secret");
            self::$client->request('GET', "$uri?secret=".self::PRIVATE_SECRET);
            $this->assertSame(200, self::$client->getResponse()->getStatusCode(), "$uri with secret");
        }
    }

    public function testDownMapsClubToPublicAndDropsSearchable(): void
    {
        ['calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $calId = $cal->getId();
        $this->insertFeed('00000000-0000-7000-8000-000000000011', $calId, 'PUBLIC', 'test-secret-value-a');
        $this->insertFeed('00000000-0000-7000-8000-000000000012', $calId, 'CLUB', 'test-secret-value-b');
        $this->insertFeed('00000000-0000-7000-8000-000000000013', $calId, 'PRIVATE', 'test-secret-value-c');
        $this->conn()->executeStatement("UPDATE calendar_feed SET searchable = 1 WHERE visibility = 'PUBLIC'");

        $this->migrate('down');

        $this->assertFalse($this->hasSearchableColumn());
        $this->assertSame('PRIVATE', $this->visibilityDefault());
        $this->assertSame([
            '00000000-0000-7000-8000-000000000011' => 'PUBLIC',
            '00000000-0000-7000-8000-000000000012' => 'PUBLIC',
            '00000000-0000-7000-8000-000000000013' => 'PRIVATE',
        ], $this->visibilities());

        // And up again: everything that was PUBLIC before is CLUB (the opt-in is gone), PRIVATE stays
        $this->migrate('up');
        $this->assertSame([
            '00000000-0000-7000-8000-000000000011' => 'CLUB',
            '00000000-0000-7000-8000-000000000012' => 'CLUB',
            '00000000-0000-7000-8000-000000000013' => 'PRIVATE',
        ], $this->visibilities());
    }
}
