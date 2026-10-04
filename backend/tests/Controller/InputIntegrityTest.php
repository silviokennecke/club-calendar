<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Regression tests: user input must never end in a 500, and assignments must stay inside one calendar.
 */
class InputIntegrityTest extends WebTestCase
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

    /**
     * @return array{user: User, calendar: Calendar, auth: string, base: string, tg: string, prop: string, feat: string, loc: string}
     */
    private function setupCalendar(): array
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}";

        return [
            'user' => $user, 'calendar' => $cal, 'auth' => $auth, 'base' => $base,
            ...$this->createReferenceData($base, $auth),
        ];
    }

    /**
     * @return array{tg: string, prop: string, feat: string, loc: string}
     */
    private function createReferenceData(string $base, string $auth): array
    {
        return [
            'tg' => TestHelper::jsonRequest(self::$client, 'POST', "$base/target-groups", ['name' => 'Jugend'], $auth)['body']['id'],
            'prop' => TestHelper::jsonRequest(self::$client, 'POST', "$base/properties", ['name' => 'Tracht'], $auth)['body']['id'],
            'feat' => TestHelper::jsonRequest(self::$client, 'POST', "$base/features", ['name' => 'Bonus'], $auth)['body']['id'],
            'loc' => TestHelper::jsonRequest(self::$client, 'POST', "$base/locations", ['name' => 'Halle'], $auth)['body']['id'],
        ];
    }

    /**
     * A second calendar in another club of the same user (the voter allows both calendars).
     *
     * @return array{tg: string, prop: string, feat: string, loc: string, template: string}
     */
    private function otherCalendarData(User $user, string $auth): array
    {
        $club = TestHelper::createClub(self::$em, $user, 'Anderer Verein');
        $other = TestHelper::createCalendar(self::$em, $club, 'Fremd');
        $base = "/api/calendars/{$other->getId()}";
        $data = $this->createReferenceData($base, $auth);
        $data['template'] = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", [
            'name' => 'Fremde Vorlage', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ], $auth)['body']['id'];

        return $data;
    }

    private function event(array $extra = []): array
    {
        return ['name' => 'Training', 'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00', ...$extra];
    }

    // --- 1. Duplicate ids ---

    public function testCreateEventWithDuplicateAssignmentIds(): void
    {
        ['auth' => $auth, 'base' => $base, 'tg' => $tg, 'prop' => $prop, 'feat' => $feat] = $this->setupCalendar();
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event([
            'targetGroupIds' => [$tg, $tg], 'propertyIds' => [$prop, $prop], 'featureIds' => [$feat, $feat],
        ]), $auth);
        $this->assertSame(201, $r['status']);
        $this->assertCount(1, $r['body']['targetGroups']);
        $this->assertCount(1, $r['body']['properties']);
        $this->assertCount(1, $r['body']['features']);
    }

    public function testCreateTemplateWithDuplicateAssignmentIds(): void
    {
        ['auth' => $auth, 'base' => $base, 'tg' => $tg, 'prop' => $prop, 'feat' => $feat] = $this->setupCalendar();
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", [
            'name' => 'Training', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
            'targetGroupIds' => [$tg, $tg], 'propertyIds' => [$prop, $prop], 'featureIds' => [$feat, $feat],
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertCount(1, $r['body']['targetGroups']);
        $this->assertCount(1, $r['body']['properties']);
        $this->assertCount(1, $r['body']['features']);
    }

    public function testImportAndFromTemplateWithDuplicateAssignmentIds(): void
    {
        ['auth' => $auth, 'base' => $base, 'tg' => $tg] = $this->setupCalendar();
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", [
            'events' => [$this->event(['targetGroupIds' => [$tg, $tg]])],
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertSame(1, $r['body']['imported']);

        $tmpl = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", [
            'name' => 'T', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ], $auth)['body']['id'];
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/from-template", [
            'templateId' => $tmpl, 'dates' => ['2026-10-01'], 'overrides' => ['targetGroupIds' => [$tg, $tg]],
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertCount(1, $r['body'][0]['targetGroups']);
    }

    public function testFeedWithDuplicateTargetGroupIds(): void
    {
        ['auth' => $auth, 'base' => $base, 'tg' => $tg] = $this->setupCalendar();
        $tg2 = TestHelper::jsonRequest(self::$client, 'POST', "$base/target-groups", ['name' => 'Senioren'], $auth)['body']['id'];
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/feeds", [
            'name' => 'Feed', 'visibility' => 'PUBLIC', 'targetGroupIds' => [$tg, $tg],
        ], $auth);
        $this->assertSame(201, $r['status']);
        $this->assertCount(1, $r['body']['targetGroups']);
        $id = $r['body']['id'];
        self::$em->clear();

        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/feeds/$id", ['targetGroupIds' => [$tg, $tg2, $tg2]], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertCount(2, $r['body']['targetGroups']);
        self::$em->clear();

        // Removing the first link must still serialize the links as a JSON list
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/feeds/$id", ['targetGroupIds' => [$tg2]], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertTrue(array_is_list($r['body']['targetGroups']));
        $this->assertSame([$tg2], array_column($r['body']['targetGroups'], 'targetGroupId'));
    }

    // --- 2. Assignments across calendars ---

    public function testEventCannotLinkDataOfAnotherCalendar(): void
    {
        ['user' => $user, 'auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $foreign = $this->otherCalendarData($user, $auth);
        $cases = [
            ['locationId' => $foreign['loc']],
            ['propertyIds' => [$foreign['prop']]],
            ['featureIds' => [$foreign['feat']]],
            ['targetGroupIds' => [$foreign['tg']]],
            ['eventTemplateId' => $foreign['template']],
        ];
        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event(), $auth)['body']['id'];
        foreach ($cases as $case) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event($case), $auth);
            $this->assertSame(422, $r['status'], 'create '.json_encode($case));
            $this->assertStringNotContainsString('Fremd', $r['content']);
            self::$em->clear();
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", $case, $auth);
            $this->assertSame(422, $r['status'], 'update '.json_encode($case));
            self::$em->clear();
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", ['events' => [$this->event($case)]], $auth);
            $this->assertSame(422, $r['status'], 'import '.json_encode($case));
            self::$em->clear();
        }
        // Nothing foreign got attached
        $r = TestHelper::jsonRequest(self::$client, 'GET', "$base/events", [], $auth);
        $this->assertCount(1, $r['body']);
        $this->assertNull($r['body'][0]['locationId']);
        $this->assertSame([], $r['body'][0]['targetGroups']);
    }

    public function testFromTemplateOverridesCannotLinkDataOfAnotherCalendar(): void
    {
        ['user' => $user, 'auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $foreign = $this->otherCalendarData($user, $auth);
        $tmpl = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", [
            'name' => 'T', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ], $auth)['body']['id'];
        foreach ([['locationId' => $foreign['loc']], ['targetGroupIds' => [$foreign['tg']]]] as $case) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/from-template", [
                'templateId' => $tmpl, 'dates' => ['2026-10-01'], 'overrides' => $case,
            ], $auth);
            $this->assertSame(422, $r['status'], json_encode($case));
        }
    }

    public function testTemplateAndFeedRejectDataOfAnotherCalendar(): void
    {
        ['user' => $user, 'auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $foreign = $this->otherCalendarData($user, $auth);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", [
            'name' => 'T', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
            'targetGroupIds' => [$foreign['tg']],
        ], $auth);
        $this->assertSame(422, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/feeds", [
            'name' => 'Feed', 'visibility' => 'PUBLIC', 'targetGroupIds' => [$foreign['tg']],
        ], $auth);
        $this->assertSame(422, $r['status']);
    }

    public function testForeignAndMalformedIdsAreRejectedAlikeWithoutOracle(): void
    {
        ['user' => $user, 'calendar' => $cal, 'auth' => $auth, 'base' => $base, 'tg' => $tg, 'prop' => $prop] = $this->setupCalendar();
        // Same club, other calendar
        $siblingId = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/calendars", ['name' => 'Geschwister'], $auth)['body']['id'];
        $siblingTg = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/$siblingId/target-groups", ['name' => 'Fremd'], $auth)['body']['id'];
        // Other user, other club (not a member)
        ['user' => $stranger, 'calendar' => $strangerCal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $strangerAuth = TestHelper::authHeader($stranger, self::$tokens);
        $strangerTg = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$strangerCal->getId()}/target-groups", ['name' => 'Fremd'], $strangerAuth)['body']['id'];
        $unknown = '0190a4c2-0000-7000-8000-000000000000';

        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event(['targetGroupIds' => [$tg]]), $auth)['body']['id'];
        $details = [];
        foreach (['sibling' => $siblingTg, 'stranger' => $strangerTg, 'unknown' => $unknown, 'malformed' => 'not-a-uuid', 'long' => str_repeat('a', 5000)] as $label => $badId) {
            foreach (['POST' => "$base/events", 'PATCH' => "$base/events/$id"] as $method => $uri) {
                $r = TestHelper::jsonRequest(self::$client, $method, $uri, $this->event(['targetGroupIds' => [$tg, $badId]]), $auth);
                $this->assertSame(422, $r['status'], "$method $label");
                $details[$label] = str_replace($badId, '<id>', (string) $r['body']['detail']);
                self::$em->clear();
            }
        }
        // Same answer for every kind of bad id: no way to tell foreign from unknown
        $this->assertCount(1, array_unique($details), json_encode($details));

        // Wrong shapes: 400, never 500
        foreach ([[[$tg]], [['id' => $tg]], [null], [true], [1.5], ['a' => ['b']]] as $shape) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", ['propertyIds' => $shape], $auth);
            $this->assertSame(400, $r['status'], json_encode($shape).' -> '.$r['content']);
            self::$em->clear();
        }
        foreach ([['locationId' => ['x']], ['locationId' => 12], ['eventTemplateId' => ['id' => 'x']], ['propertyIds' => [12]], ['propertyIds' => ['']]] as $case) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", $case, $auth);
            $this->assertContains($r['status'], [400, 422], json_encode($case).' -> '.$r['content']);
            self::$em->clear();
        }

        // Ids in another spelling (MySQL compares case-insensitively) must not duplicate or collide
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", [
            'targetGroupIds' => [$tg, strtoupper($tg)], 'propertyIds' => [strtoupper($prop), $prop],
        ], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame([$tg], array_map(fn ($g) => $g['targetGroup']['id'], $r['body']['targetGroups']));
        $this->assertSame([$prop], array_map(fn ($p) => $p['property']['id'], $r['body']['properties']));
        self::$em->clear();

        // Long lists of valid duplicates stay fine; nothing changed by the rejected requests
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", ['targetGroupIds' => array_fill(0, 2000, $tg)], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertCount(1, $r['body']['targetGroups']);
    }

    // --- 3. Import validation ---

    public function testImportRejectsMissingOrInvalidFields(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $invalid = [
            ['name' => null],
            ['name' => ''],
            ['date' => null],
            ['date' => 'kein-datum'],
            ['date' => '2026-02-30'],
            ['timeBegin' => null],
            ['timeEnd' => '25:00'],
            ['timeBegin' => 'abends'],
            ['dateEnd' => '2026-09-30'],
            ['isAllDay' => 'yes'],
            ['propertyIds' => 'abc'],
        ];
        foreach ($invalid as $case) {
            $event = $this->event();
            foreach ($case as $k => $v) {
                if (null === $v) {
                    unset($event[$k]);
                } else {
                    $event[$k] = $v;
                }
            }
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", ['events' => [$this->event(), $event]], $auth);
            $this->assertSame(400, $r['status'], 'import '.json_encode($case).' -> '.$r['content']);
            self::$em->clear();
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $event, $auth);
            $this->assertSame(400, $r['status'], 'create '.json_encode($case).' -> '.$r['content']);
            self::$em->clear();
        }
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", ['events' => ['kein-objekt']], $auth);
        $this->assertSame(400, $r['status']);
        // Nothing was stored from the rejected requests
        $this->assertSame([], TestHelper::jsonRequest(self::$client, 'GET', "$base/events", [], $auth)['body']);
    }

    public function testUpdateRejectsInvalidFields(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event(), $auth)['body']['id'];
        foreach ([['name' => null], ['timeBegin' => '7 Uhr'], ['isDraft' => 'no'], ['date' => '2026-13-01'], ['dateEnd' => '2026-01-01']] as $case) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", $case, $auth);
            $this->assertSame(400, $r['status'], json_encode($case).' -> '.$r['content']);
            self::$em->clear();
        }
    }

    public function testResourcesRejectMissingName(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->setupCalendar();
        foreach (['properties', 'features', 'target-groups'] as $res) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/$res", ['icon' => 'x'], $auth);
            $this->assertSame(400, $r['status'], $res);
        }
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", ['name' => 'T'], $auth);
        $this->assertSame(400, $r['status'], 'templates');
    }

    public function testLocationTextsLongerThanTheirColumnsAreRejected(): void
    {
        ['auth' => $auth, 'base' => $base, 'loc' => $loc] = $this->setupCalendar();
        foreach (['country' => 101, 'zip' => 21, 'name' => 256] as $field => $length) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/locations", [$field => str_repeat('x', $length)], $auth);
            $this->assertSame(400, $r['status'], "create $field");
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/locations/$loc", [$field => str_repeat('x', $length)], $auth);
            $this->assertSame(400, $r['status'], "update $field");
        }
    }

    // --- 7. Time zones ---

    public function testInvalidTimezonesAreRejected(): void
    {
        ['user' => $user, 'calendar' => $cal, 'auth' => $auth, 'base' => $base] = $this->setupCalendar();
        $bad = 'W. Europe Standard Time';
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event(['timezone' => $bad]), $auth);
        $this->assertSame(422, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", ['events' => [$this->event(['timezone' => $bad])]], $auth);
        $this->assertSame(422, $r['status']);
        $id = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $this->event(['timezone' => 'Europe/Vienna']), $auth)['body']['id'];
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", ['timezone' => $bad], $auth);
        $this->assertSame(422, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", ['timezone' => null], $auth);
        $this->assertSame(200, $r['status']);
        // PHP (and ICS files in the wild) treat zone names case-insensitively: accepted, stored canonical
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events/import", ['events' => [$this->event(['timezone' => 'europe/berlin'])]], $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/events/$id", ['timezone' => 'america/new_york'], $auth);
        $this->assertSame('America/New_York', $r['body']['timezone']);

        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/templates", [
            'name' => 'T', 'timezone' => $bad, 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ], $auth);
        $this->assertSame(422, $r['status']);

        $clubId = $cal->getClub()->getId();
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "/api/clubs/$clubId/calendars/{$cal->getId()}", ['timezone' => $bad], $auth);
        $this->assertSame(422, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/$clubId/calendars", ['name' => 'K', 'timezone' => $bad], $auth);
        $this->assertSame(422, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "/api/clubs/$clubId", ['timezone' => $bad], $auth);
        $this->assertSame(422, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/clubs', ['name' => 'V', 'timezone' => $bad], $auth);
        $this->assertSame(422, $r['status']);
    }

    public function testClubAndCalendarUpdateRejectInvalidName(): void
    {
        ['calendar' => $cal, 'auth' => $auth] = $this->setupCalendar();
        $clubId = $cal->getClub()->getId();
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "/api/clubs/$clubId/calendars/{$cal->getId()}", ['name' => null], $auth);
        $this->assertSame(400, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "/api/clubs/$clubId", ['name' => ['x']], $auth);
        $this->assertSame(400, $r['status']);
    }
}
