<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Enum\ClubRole;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** updated_at / updated_by_id are filled by App\Doctrine\UpdateAuditListener. */
class UpdateAuditTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        self::$tokens = static::getContainer()->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    private function conn(): Connection
    {
        return self::$em->getConnection();
    }

    /** @return array{updated_at: string, updated_by_id: ?string} */
    private function audit(string $table, string $id): array
    {
        /** @var array{updated_at: string, updated_by_id: ?string} $row */
        $row = $this->conn()->fetchAssociative("SELECT updated_at, updated_by_id FROM `$table` WHERE id = ?", [$id]);

        return $row;
    }

    public function testWithoutSignedInUserTimestampIsSetAndUserIsNull(): void
    {
        $club = new Club();
        $club->setName('Cli Club');
        $club->setTimezone('Europe/Berlin');
        self::$em->persist($club);
        self::$em->flush();

        $row = $this->audit('club', $club->getId());
        $this->assertNull($row['updated_by_id']);
        $this->assertNotEmpty($row['updated_at']);

        $this->conn()->executeStatement("UPDATE club SET updated_at = '2020-01-01 00:00:00'");
        $club->setName('Renamed');
        self::$em->flush();

        $row = $this->audit('club', $club->getId());
        $this->assertGreaterThan('2020-01-01 00:00:00', $row['updated_at']);
        $this->assertNull($row['updated_by_id']);
    }

    public function testSignedInUserIsRecordedOnCreateAndUpdate(): void
    {
        ['user' => $user, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/clubs/{$club->getId()}/target-groups";

        $created = TestHelper::jsonRequest(self::$client, 'POST', $base, ['name' => 'Jugend'], $auth);
        $this->assertSame(201, $created['status'], $created['content']);
        $id = $created['body']['id'];
        $this->assertSame($user->getId(), $this->audit('target_group', $id)['updated_by_id']);

        $this->conn()->executeStatement("UPDATE target_group SET updated_at = '2020-01-01 00:00:00', updated_by_id = NULL");
        $updated = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/$id", ['name' => 'Schüler'], $auth);
        $this->assertSame(200, $updated['status'], $updated['content']);

        $row = $this->audit('target_group', $id);
        $this->assertGreaterThan('2020-01-01 00:00:00', $row['updated_at']);
        $this->assertSame($user->getId(), $row['updated_by_id']);
    }

    public function testChangingOnlyTheTargetGroupsOfAnEventTouchesTheEvent(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $group = TestHelper::createTargetGroup(self::$em, $club, 'Jugend');
        $event = TestHelper::createEvent(self::$em, $cal);
        $eventId = $event->getId();

        $this->conn()->executeStatement("UPDATE event SET updated_at = '2020-01-01 00:00:00'");
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "/api/calendars/{$cal->getId()}/events/$eventId", ['targetGroupIds' => [$group->getId()]], $auth);
        $this->assertSame(200, $r['status'], $r['content']);

        $this->assertSame(1, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM event_target_group WHERE event_id = ?', [$eventId]));
        $row = $this->audit('event', $eventId);
        $this->assertGreaterThan('2020-01-01 00:00:00', $row['updated_at']);
        $this->assertSame($user->getId(), $row['updated_by_id']);

        // Removing the assignment again touches the event as well
        $this->conn()->executeStatement("UPDATE event SET updated_at = '2020-01-01 00:00:00', updated_by_id = NULL");
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "/api/calendars/{$cal->getId()}/events/$eventId", ['targetGroupIds' => []], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(0, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM event_target_group WHERE event_id = ?', [$eventId]));
        $row = $this->audit('event', $eventId);
        $this->assertGreaterThan('2020-01-01 00:00:00', $row['updated_at']);
        $this->assertSame($user->getId(), $row['updated_by_id']);
    }

    public function testAssociationRowAddedWithoutRequestTouchesOwner(): void
    {
        ['club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $group = TestHelper::createTargetGroup(self::$em, $club);
        $event = TestHelper::createEvent(self::$em, $cal);
        $this->conn()->executeStatement("UPDATE event SET updated_at = '2020-01-01 00:00:00'");

        $link = (new EventTargetGroup())->setEvent($event)->setTargetGroup($group);
        self::$em->persist($link);
        self::$em->flush();

        $this->assertGreaterThan('2020-01-01 00:00:00', $this->audit('event', $event->getId())['updated_at']);
        $this->assertInstanceOf(Event::class, self::$em->find(Event::class, $event->getId()));
    }

    public function testDeletingTheUserClearsUpdatedByAndAccountDeletionSucceeds(): void
    {
        ['user' => $user, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $other = TestHelper::createUser(self::$em, self::$hasher);
        TestHelper::addMember(self::$em, $club, $other, ClubRole::ADMIN);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $created = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$club->getId()}/target-groups", ['name' => 'Jugend'], $auth);
        $id = $created['body']['id'];
        $this->assertSame($user->getId(), $this->audit('target_group', $id)['updated_by_id']);

        $r = TestHelper::deleteAccount(self::$client, $user, self::$tokens);
        $this->assertSame(200, $r['status'], $r['content']);

        $this->assertNull($this->audit('target_group', $id)['updated_by_id']);
        $this->assertSame(1, (int) $this->conn()->fetchOne('SELECT COUNT(*) FROM target_group WHERE id = ?', [$id]));
    }
}
