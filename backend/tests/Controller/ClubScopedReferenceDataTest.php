<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Locations and target groups belong to the club and are shared by all of its calendars.
 */
class ClubScopedReferenceDataTest extends WebTestCase
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

    /** @return iterable<string, array{string, array<string, mixed>, array<string, mixed>}> */
    public static function resources(): iterable
    {
        yield 'locations' => ['locations', ['name' => 'Halle', 'city' => 'Bonn'], ['name' => 'Neue Halle']];
        yield 'target groups' => ['target-groups', ['name' => 'Jugend'], ['name' => 'Schüler']];
    }

    /** @return array<string, mixed> */
    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    /** @param array<string, mixed> $create @param array<string, mixed> $patch */
    #[DataProvider('resources')]
    public function testClubScopedCrud(string $path, array $create, array $patch): void
    {
        ['user' => $user, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/clubs/{$club->getId()}/$path";

        $this->assertSame([], $this->req('GET', $base, $auth)['body']);
        $created = $this->req('POST', $base, $auth, $create);
        $this->assertSame(201, $created['status'], $created['content']);
        $this->assertSame($club->getId(), $created['body']['clubId']);
        $this->assertArrayNotHasKey('calendarId', $created['body']);
        $id = $created['body']['id'];

        $list = $this->req('GET', $base, $auth)['body'];
        $this->assertCount(1, $list);
        $this->assertArrayHasKey('usage', $list[0]);

        $updated = $this->req('PATCH', "$base/$id", $auth, $patch);
        $this->assertSame(200, $updated['status'], $updated['content']);
        $this->assertSame($patch['name'], $updated['body']['name']);

        $this->assertSame(200, $this->req('DELETE', "$base/$id", $auth)['status']);
        $this->assertSame([], $this->req('GET', $base, $auth)['body']);
        $this->assertSame(404, $this->req('DELETE', "$base/$id", $auth)['status']);
    }

    #[DataProvider('resources')]
    public function testOldCalendarRoutesAreGone(string $path, array $create = [], array $patch = []): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $this->assertSame(404, $this->req('GET', "/api/calendars/{$cal->getId()}/$path", $auth)['status']);
        $this->assertSame(404, $this->req('POST', "/api/calendars/{$cal->getId()}/$path", $auth, ['name' => 'X'])['status']);
    }

    /** @param array<string, mixed> $create @param array<string, mixed> $patch */
    #[DataProvider('resources')]
    public function testOtherClubsAreDeniedAndIdsDoNotCrossClubs(string $path, array $create, array $patch): void
    {
        ['user' => $user, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $stranger, 'club' => $foreignClub] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $strangerAuth = TestHelper::authHeader($stranger, self::$tokens);
        $id = $this->req('POST', "/api/clubs/{$club->getId()}/$path", $auth, $create)['body']['id'];

        // Not a member: 403 for reads and writes, nothing changes
        $base = "/api/clubs/{$club->getId()}/$path";
        $this->assertSame(403, $this->req('GET', $base, $strangerAuth)['status']);
        $this->assertSame(403, $this->req('POST', $base, $strangerAuth, $create)['status']);
        $this->assertSame(403, $this->req('PATCH', "$base/$id", $strangerAuth, $patch)['status']);
        $this->assertSame(403, $this->req('DELETE', "$base/$id", $strangerAuth)['status']);
        // No token: 401 before any id is looked up
        $this->assertSame(401, $this->req('GET', $base, '')['status']);

        // An id of another club through the own club is 404 (own club, foreign id)
        $foreignBase = "/api/clubs/{$foreignClub->getId()}/$path";
        $this->assertSame(404, $this->req('PATCH', "$foreignBase/$id", $strangerAuth, $patch)['status']);
        $this->assertSame(404, $this->req('DELETE', "$foreignBase/$id", $strangerAuth)['status']);
        $this->assertCount(1, $this->req('GET', $base, $auth)['body']);
    }

    public function testCalendarsOfOneClubShareTheDataAndNamesAreUniquePerClub(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $first] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $second = TestHelper::createCalendar(self::$em, $club, 'Zweiter');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $clubBase = "/api/clubs/{$club->getId()}";

        $group = $this->req('POST', "$clubBase/target-groups", $auth, ['name' => 'Jugend']);
        $this->assertSame(201, $group['status']);
        $dup = $this->req('POST', "$clubBase/target-groups", $auth, ['name' => ' jugend ']);
        $this->assertSame(422, $dup['status']);
        $this->assertSame('duplicate_name', $dup['body']['code']);
        $this->assertStringContainsString('already exists in this club', $dup['body']['detail']);

        $loc = $this->req('POST', "$clubBase/locations", $auth, ['name' => 'Halle'])['body']['id'];
        $event = ['date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'locationId' => $loc, 'targetGroupIds' => [$group['body']['id']]];
        foreach ([$first, $second] as $cal) {
            $r = $this->req('POST', "/api/calendars/{$cal->getId()}/events", $auth, ['name' => 'Termin '.$cal->getName()] + $event);
            $this->assertSame(201, $r['status'], $r['content']);
        }

        // Usage counts the events of both calendars
        $groups = $this->req('GET', "$clubBase/target-groups", $auth)['body'];
        $this->assertSame(2, $groups[0]['usage']['events']);
        $locations = $this->req('GET', "$clubBase/locations", $auth)['body'];
        $this->assertSame(2, $locations[0]['usage']['events']);
    }

    public function testReferencesOfAnotherClubAreUnknownReferences(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        ['user' => $stranger, 'club' => $foreignClub] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $strangerAuth = TestHelper::authHeader($stranger, self::$tokens);
        $foreignCal = $this->req('GET', "/api/clubs/{$foreignClub->getId()}/calendars", $strangerAuth)['body'][0]['id'];
        $foreign = [
            'locationId' => $this->req('POST', "/api/clubs/{$foreignClub->getId()}/locations", $strangerAuth, ['name' => 'Fremd'])['body']['id'],
            'propertyIds' => [$this->req('POST', "/api/calendars/$foreignCal/properties", $strangerAuth, ['name' => 'Fremd'])['body']['id']],
            'featureIds' => [$this->req('POST', "/api/calendars/$foreignCal/features", $strangerAuth, ['name' => 'Fremd'])['body']['id']],
            'targetGroupIds' => [$this->req('POST', "/api/clubs/{$foreignClub->getId()}/target-groups", $strangerAuth, ['name' => 'Fremd'])['body']['id']],
        ];
        $base = "/api/calendars/{$cal->getId()}";
        foreach ($foreign as $field => $value) {
            $event = $this->req('POST', "$base/events", $auth, ['name' => 'E', 'date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00', $field => $value]);
            $this->assertSame(422, $event['status'], $field.' '.$event['content']);
            $this->assertSame('unknown_reference', $event['body']['code'], $field);
            $this->assertSame($field, $event['body']['field'], $field);
            $this->assertStringContainsString(in_array($field, ['propertyIds', 'featureIds'], true) ? 'in this calendar' : 'in this club', $event['body']['detail']);

            $template = $this->req('POST', "$base/templates", $auth, ['name' => 'T', 'timeBegin' => '18:00', 'timeEnd' => '20:00', $field => $value]);
            $this->assertSame(422, $template['status'], $field.' '.$template['content']);
            $this->assertSame('unknown_reference', $template['body']['code'], $field);
        }
    }

    public function testArchivedCalendarsDoNotBlockClubLevelWrites(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $this->assertSame(200, $this->req('POST', "/api/clubs/{$club->getId()}/calendars/{$cal->getId()}/archive", $auth)['status']);
        $this->assertSame(201, $this->req('POST', "/api/clubs/{$club->getId()}/locations", $auth, ['name' => 'Halle'])['status']);
    }

    public function testImportCreatesLocationsAtClubLevel(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = $this->req('POST', "/api/calendars/{$cal->getId()}/events/import", $auth, [
            'locations' => [['tempId' => 'a', 'name' => 'Importiert']],
            'events' => [['name' => 'A', 'date' => '2027-01-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00', 'locationTempId' => 'a']],
        ]);
        $this->assertSame(201, $r['status'], $r['content']);
        $list = $this->req('GET', "/api/clubs/{$club->getId()}/locations", $auth)['body'];
        $this->assertSame(['Importiert'], array_column($list, 'name'));
        $this->assertSame(1, $list[0]['usage']['events']);
    }
}
