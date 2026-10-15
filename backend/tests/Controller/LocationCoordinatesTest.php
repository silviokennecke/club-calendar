<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Location;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Location coordinates: JSON numbers, latitude -90..90, longitude -180..180, only as a pair (or both
 * null/absent); otherwise 422 validation_failed with the field. Create, update and new places of the
 * event import.
 */
class LocationCoordinatesTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
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

    /** @return array{base: string, auth: string, calendarId: string} */
    private function setupCalendar(): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return [
            'base' => "/api/calendars/{$cal->getId()}",
            'auth' => TestHelper::authHeader($user, self::$tokens),
            'calendarId' => $cal->getId(),
        ];
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> body => expected field */
    private static function invalidBodies(): array
    {
        return [
            'lat string' => [['latitude' => 'abc', 'longitude' => 7.0], 'latitude'],
            'lat numeric string' => [['latitude' => '51.5', 'longitude' => 7.0], 'latitude'],
            'lng bool' => [['latitude' => 51.0, 'longitude' => true], 'longitude'],
            'lng array' => [['latitude' => 51.0, 'longitude' => [7]], 'longitude'],
            'lat object' => [['latitude' => ['a' => 1], 'longitude' => 7.0], 'latitude'],
            'lat > 90' => [['latitude' => 90.0001, 'longitude' => 7.0], 'latitude'],
            'lat < -90' => [['latitude' => -91, 'longitude' => 7.0], 'latitude'],
            'lng > 180' => [['latitude' => 51.0, 'longitude' => 180.5], 'longitude'],
            'lng < -180' => [['latitude' => 51.0, 'longitude' => -181], 'longitude'],
            'only lat' => [['latitude' => 51.0], 'longitude'],
            'only lng' => [['longitude' => 7.0], 'latitude'],
            'lat with lng null' => [['latitude' => 51.0, 'longitude' => null], 'longitude'],
            'lat null with lng' => [['latitude' => null, 'longitude' => 7.0], 'latitude'],
        ];
    }

    private function locationCount(string $calendarId): int
    {
        return (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM location WHERE calendar_id = ?', [$calendarId]);
    }

    public function testCreateRejectsInvalidCoordinates(): void
    {
        ['base' => $base, 'auth' => $auth, 'calendarId' => $calendarId] = $this->setupCalendar();
        foreach (self::invalidBodies() as $label => [$body, $field]) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/locations", ['name' => 'Halle'] + $body, $auth);
            $this->assertSame(422, $r['status'], $label.' '.$r['content']);
            $this->assertSame('validation_failed', $r['body']['code'] ?? null, $label);
            $this->assertSame($field, $r['body']['field'] ?? null, $label);
        }
        $this->assertSame(0, $this->locationCount($calendarId));
    }

    public function testCreateAcceptsPairsBoundsAndNoPosition(): void
    {
        ['base' => $base, 'auth' => $auth] = $this->setupCalendar();
        foreach ([
            [['latitude' => 51.5, 'longitude' => 7.25], [51.5, 7.25]],
            [['latitude' => 90, 'longitude' => -180], [90.0, -180.0]],
            [['latitude' => -90, 'longitude' => 180], [-90.0, 180.0]],
            [['latitude' => 0, 'longitude' => 0], [0.0, 0.0]],
            [['latitude' => null, 'longitude' => null], [null, null]],
            [[], [null, null]],
        ] as [$body, [$lat, $lng]]) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/locations", ['name' => 'Halle'] + $body, $auth);
            $this->assertSame(201, $r['status'], json_encode($body).' '.$r['content']);
            $this->assertEquals($lat, $r['body']['latitude'], json_encode($body));
            $this->assertEquals($lng, $r['body']['longitude'], json_encode($body));
        }
    }

    public function testUpdateValidatesTheResultingPair(): void
    {
        ['base' => $base, 'auth' => $auth] = $this->setupCalendar();
        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/locations", ['name' => 'Halle', 'latitude' => 51.0, 'longitude' => 7.0], $auth)['body']['id'];

        foreach (self::invalidBodies() as $label => [$body, $field]) {
            if (1 === count($body)) {
                continue; // one coordinate alone is fine on update while the other one stays
            }
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/locations/$id", $body, $auth);
            $this->assertSame(422, $r['status'], $label.' '.$r['content']);
            $this->assertSame('validation_failed', $r['body']['code'] ?? null, $label);
            $this->assertSame($field, $r['body']['field'] ?? null, $label);
        }
        foreach ([[['latitude' => null], 'latitude'], [['longitude' => null], 'longitude'], [['latitude' => 'x'], 'latitude'], [['longitude' => 200], 'longitude']] as [$body, $field]) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/locations/$id", $body, $auth);
            $this->assertSame(422, $r['status'], json_encode($body).' '.$r['content']);
            $this->assertSame($field, $r['body']['field'] ?? null, json_encode($body));
        }
        self::$em->clear();
        $stored = self::$em->find(Location::class, $id);
        $this->assertSame([51.0, 7.0], [$stored?->getLatitude(), $stored?->getLongitude()]);

        // One coordinate moves while the other stays; both null removes the position
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/locations/$id", ['latitude' => 52.5], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertEquals([52.5, 7.0], [$r['body']['latitude'], $r['body']['longitude']]);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/locations/$id", ['latitude' => null, 'longitude' => null], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame([null, null], [$r['body']['latitude'], $r['body']['longitude']]);
    }

    public function testStoredHalfPairsStayEditableWithoutTouchingTheCoordinates(): void
    {
        ['base' => $base, 'auth' => $auth, 'calendarId' => $calendarId] = $this->setupCalendar();
        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/locations", ['name' => 'Alt'], $auth)['body']['id'];
        // Written before the check existed
        self::$em->getConnection()->executeStatement('UPDATE location SET latitude = 51.0 WHERE id = ?', [$id]);

        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/locations/$id", ['name' => 'Neu'], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('Neu', $r['body']['name']);
        $this->assertEquals(51.0, $r['body']['latitude']);
        $this->assertSame(1, $this->locationCount($calendarId));
    }

    public function testImportRejectsInvalidCoordinatesOfNewPlaces(): void
    {
        ['base' => $base, 'auth' => $auth, 'calendarId' => $calendarId] = $this->setupCalendar();
        $event = ['name' => 'Fest', 'date' => '2026-08-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00', 'locationTempId' => 'p'];
        foreach ([[['latitude' => 'x', 'longitude' => 7.0], 'latitude'], [['latitude' => 51.0], 'longitude'], [['latitude' => 51.0, 'longitude' => 999], 'longitude']] as [$coords, $field]) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", [
                'locations' => [['tempId' => 'p', 'name' => 'Linde'] + $coords],
                'events' => [$event],
            ], $auth);
            $this->assertSame(422, $r['status'], json_encode($coords).' '.$r['content']);
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame("locations[0].$field", $r['body']['field']);
        }
        $this->assertSame(0, $this->locationCount($calendarId));

        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", [
            'locations' => [['tempId' => 'p', 'name' => 'Linde', 'latitude' => 51.0, 'longitude' => 7.0]],
            'events' => [$event],
        ], $auth);
        $this->assertContains($r['status'], [200, 201], $r['content']);
        $this->assertSame(1, $this->locationCount($calendarId));
    }
}
