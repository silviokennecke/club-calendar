<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ResourcesTest extends WebTestCase
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

    // --- Properties ---

    public function testPropertyCrud(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/properties";

        $list = TestHelper::jsonRequest(self::$client, 'GET', $base, [], $auth);
        $this->assertSame([], $list['body']);

        $create = TestHelper::jsonRequest(self::$client, 'POST', $base, ['name' => 'Indoor', 'icon' => '🏠'], $auth);
        $this->assertSame(201, $create['status']);
        $id = $create['body']['id'];

        $update = TestHelper::jsonRequest(self::$client, 'PATCH', "$base/$id", ['name' => 'Outdoor'], $auth);
        $this->assertSame(200, $update['status']);
        $this->assertSame('Outdoor', $update['body']['name']);

        $delete = TestHelper::jsonRequest(self::$client, 'DELETE', "$base/$id", [], $auth);
        $this->assertSame(200, $delete['status']);
    }

    public function testFeatureCrudAndCalendarScope(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $other = TestHelper::createCalendar(self::$em, $club, 'Zweiter');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/features";

        $create = TestHelper::jsonRequest(self::$client, 'POST', $base, ['name' => 'Bonus'], $auth);
        $this->assertSame(201, $create['status']);
        $this->assertSame($cal->getId(), $create['body']['calendarId']);
        $id = $create['body']['id'];

        // Not visible, not changeable through the other calendar of the same club
        $this->assertSame([], TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$other->getId()}/features", [], $auth)['body']);
        $this->assertSame(404, TestHelper::jsonRequest(self::$client, 'DELETE', "/api/calendars/{$other->getId()}/features/$id", [], $auth)['status']);
        // The club-level route does not exist
        $this->assertSame(404, TestHelper::jsonRequest(self::$client, 'GET', "/api/clubs/{$club->getId()}/features", [], $auth)['status']);

        $this->assertSame('Bonus 2', TestHelper::jsonRequest(self::$client, 'PATCH', "$base/$id", ['name' => 'Bonus 2'], $auth)['body']['name']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'DELETE', "$base/$id", [], $auth)['status']);
    }

    public function testPropertyOfAnotherCalendarIsAnUnknownReference(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $other = TestHelper::createCalendar(self::$em, $club, 'Zweiter');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $prop = TestHelper::createProperty(self::$em, $other)->getId();
        $feature = TestHelper::createFeature(self::$em, $other)->getId();

        foreach (['propertyIds' => [$prop], 'featureIds' => [$feature]] as $field => $value) {
            $event = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/events", ['name' => 'E', 'date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00', $field => $value], $auth);
            $this->assertSame(422, $event['status'], $event['content']);
            $this->assertSame('unknown_reference', $event['body']['code']);
            $this->assertSame($field, $event['body']['field']);
            $template = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/templates", ['name' => 'T', 'timeBegin' => '18:00', 'timeEnd' => '20:00', $field => $value], $auth);
            $this->assertSame('unknown_reference', $template['body']['code']);
        }
    }

    // --- Templates ---

    public function testTemplateCrud(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/templates";

        $create = TestHelper::jsonRequest(self::$client, 'POST', $base, [
            'name' => 'Weekly Training', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
        ], $auth);
        $this->assertSame(201, $create['status']);
        $id = $create['body']['id'];
        $this->assertSame('Weekly Training', $create['body']['name']);

        $get = TestHelper::jsonRequest(self::$client, 'GET', "$base/$id", [], $auth);
        $this->assertSame(200, $get['status']);
        $this->assertSame($id, $get['body']['id']);

        $delete = TestHelper::jsonRequest(self::$client, 'DELETE', "$base/$id", [], $auth);
        $this->assertSame(200, $delete['status']);
    }

    public function testTemplateUpdateKeepsUnchangedAndSyncsChangedAssignments(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $calBase = "/api/calendars/{$cal->getId()}";
        $youth = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/target-groups", ['name' => 'Jugend'], $auth)['body']['id'];
        $adults = TestHelper::jsonRequest(self::$client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/target-groups", ['name' => 'Erwachsene'], $auth)['body']['id'];
        $create = TestHelper::jsonRequest(self::$client, 'POST', "$calBase/templates", [
            'name' => 'Training', 'timezone' => 'Europe/Berlin', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
            'targetGroupIds' => [$youth],
        ], $auth);
        $this->assertSame(201, $create['status']);
        $id = $create['body']['id'];
        self::$em->clear();

        // Sending an unchanged assignment again must not fail (identity collision on composite ids).
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$calBase/templates/$id", [
            'targetGroupIds' => [$youth, $adults], 'propertyIds' => [], 'featureIds' => [],
        ], $auth);
        $this->assertSame(200, $r['status']);
        self::$em->clear();

        $r = TestHelper::jsonRequest(self::$client, 'PATCH', "$calBase/templates/$id", ['targetGroupIds' => [$adults]], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame([$adults], array_map(fn ($g) => $g['targetGroup']['id'], $r['body']['targetGroups']));
        self::$em->clear();

        $r = TestHelper::jsonRequest(self::$client, 'GET', "$calBase/templates/$id", [], $auth);
        $this->assertSame([$adults], array_map(fn ($g) => $g['targetGroup']['id'], $r['body']['targetGroups']));
    }

    // --- Archived calendar guard ---

    /**
     * @throws \DateMalformedStringException
     */
    public function testArchivedCalendarBlocksWrites(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $cal->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();

        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'POST', "/api/calendars/{$cal->getId()}/events", [
            'name' => 'Blocked', 'date' => '2026-07-01', 'timeBegin' => '10:00', 'timeEnd' => '11:00',
        ], $auth);
        $this->assertSame(403, $r['status']);
    }

    public function testArchivedCalendarAllowsReads(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $cal->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();

        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', "/api/calendars/{$cal->getId()}/events", [], $auth);
        $this->assertSame(200, $r['status']);
    }
}
