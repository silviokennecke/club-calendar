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

/** `q` text search of GET /api/calendars/:id/events. */
class EventSearchTest extends WebTestCase
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

    /** @return array{auth: string, base: string, club: \App\Entity\Club, cal: \App\Entity\Calendar} */
    private function prepare(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return ['auth' => TestHelper::authHeader($user, self::$tokens), 'base' => "/api/calendars/{$cal->getId()}", 'club' => $club, 'cal' => $cal];
    }

    private function create(string $base, string $auth, array $extra): string
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', "$base/events", $extra + ['name' => 'Event', 'date' => '2026-10-03', 'timeBegin' => '19:00', 'timeEnd' => '21:00'], $auth);
        $this->assertSame(201, $r['status'], $r['content']);

        return $r['body']['id'];
    }

    /** @return array{names: list<string>, total: string, status: int} */
    private function search(string $base, string $auth, string $qs): array
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', "$base/events?$qs", [], $auth);
        $names = 200 === $r['status'] ? array_column($r['body'], 'name') : [];

        return ['names' => $names, 'total' => self::$client->getResponse()->headers->get('X-Total-Count') ?? '', 'status' => $r['status'], 'body' => $r['body']];
    }

    public function testMatchesNameNoteLocationAndFeatureCaseInsensitive(): void
    {
        ['auth' => $auth, 'base' => $base, 'club' => $club, 'cal' => $cal] = $this->prepare();
        $loc = TestHelper::createLocation(self::$em, $club, 'Schießhalle Nord');
        $f1 = TestHelper::createFeature(self::$em, $cal, 'Bonusschießen');
        $f2 = TestHelper::createFeature(self::$em, $cal, 'Bonus Grillen');

        $this->create($base, $auth, ['name' => 'Pokalabend']);
        $this->create($base, $auth, ['name' => 'Training', 'note' => 'Bitte Pokal mitbringen', 'date' => '2026-10-04']);
        $this->create($base, $auth, ['name' => 'Treffen', 'locationId' => $loc->getId(), 'date' => '2026-10-05']);
        $this->create($base, $auth, ['name' => 'Fest', 'featureIds' => [$f1->getId(), $f2->getId()], 'date' => '2026-10-06']);
        $this->create($base, $auth, ['name' => 'Sonstiges', 'date' => '2026-10-07']);

        $r = $this->search($base, $auth, 'q=POKAL');
        $this->assertSame(['Pokalabend', 'Training'], $r['names']);
        $this->assertSame('2', $r['total']);

        $this->assertSame(['Treffen'], $this->search($base, $auth, 'q='.urlencode('  schießhalle '))['names']);

        // two matching features: the event appears once
        $r = $this->search($base, $auth, 'q=bonus');
        $this->assertSame(['Fest'], $r['names']);
        $this->assertSame('1', $r['total']);

        $r = $this->search($base, $auth, 'q=');
        $this->assertCount(5, $r['names']);
        $this->assertSame('5', $r['total']);
        $this->assertSame([], $this->search($base, $auth, 'q=nichtda')['names']);
    }

    public function testWildcardsAreLiteral(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();
        $this->create($base, $auth, ['name' => '100% Einsatz']);
        $this->create($base, $auth, ['name' => 'a_b', 'date' => '2026-10-04']);
        $this->create($base, $auth, ['name' => 'axb', 'date' => '2026-10-05']);
        $this->create($base, $auth, ['name' => 'Back\\slash', 'date' => '2026-10-06']);

        $this->assertSame(['100% Einsatz'], $this->search($base, $auth, 'q='.urlencode('%'))['names']);
        $this->assertSame(['a_b'], $this->search($base, $auth, 'q='.urlencode('a_b'))['names']);
        $this->assertSame(['Back\\slash'], $this->search($base, $auth, 'q='.urlencode('\\'))['names']);
    }

    public function testCombinesWithRangeAndPaging(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();
        foreach (['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-01'] as $d) {
            $this->create($base, $auth, ['name' => "Match $d", 'date' => $d]);
        }
        $this->create($base, $auth, ['name' => 'Other', 'date' => '2026-10-04']);

        $r = $this->search($base, $auth, 'q=match&limit=2&offset=1');
        $this->assertSame(['Match 2026-10-02', 'Match 2026-10-03'], $r['names']);
        $this->assertSame('4', $r['total']);

        $r = $this->search($base, $auth, 'q=match&from=2026-10-01&to=2026-10-31&limit=1');
        $this->assertSame(['Match 2026-10-01'], $r['names']);
        $this->assertSame('3', $r['total']);
    }

    public function testInvalidQ(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();

        $r = $this->search($base, $auth, 'q='.str_repeat('a', 101));
        $this->assertSame(400, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('q', $r['body']['field']);

        $this->assertSame(200, $this->search($base, $auth, 'q='.str_repeat('a', 100))['status']);

        $r = $this->search($base, $auth, 'q[]=x');
        $this->assertSame(400, $r['status']);
        $this->assertSame('q', $r['body']['field']);
    }
}
