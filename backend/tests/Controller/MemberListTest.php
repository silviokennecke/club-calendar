<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** `GET /api/clubs/:id/members`: pagination, search, role filter, ordering, total header. */
class MemberListTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private Club $club;

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
        $this->admin = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $this->admin->setName('Aaron Admin');
        $this->club = TestHelper::createClub(self::$em, $this->admin);
        for ($i = 1; $i <= 14; ++$i) {
            $u = TestHelper::createUser(self::$em, self::$hasher, sprintf('m%02d@example.com', $i));
            $u->setName(sprintf('Member %02d', $i));
            TestHelper::addMember(self::$em, $this->club, $u, 0 === $i % 2 ? ClubRole::MEMBER : ClubRole::VIEWER);
        }
        self::$em->flush();
    }

    /** @return array{status: int, body: mixed, headers: array<string, list<string>>} */
    private function list(string $query = ''): array
    {
        return TestHelper::jsonRequest(self::$client, 'GET', "/api/clubs/{$this->club->getId()}/members$query", [], TestHelper::authHeader($this->admin, self::$tokens));
    }

    private function total(array $r): string
    {
        return $r['headers']['x-total-count'][0] ?? '';
    }

    public function testDefaultsToTenSortedByName(): void
    {
        $r = $this->list();
        $this->assertSame(200, $r['status']);
        $this->assertCount(10, $r['body']);
        $this->assertSame('15', $this->total($r));
        $this->assertSame('Aaron Admin', $r['body'][0]['name']);
        $this->assertSame('Member 09', $r['body'][9]['name']);
    }

    public function testSecondPageAndPerPage(): void
    {
        $r = $this->list('?page=2&perPage=10');
        $this->assertCount(5, $r['body']);
        $this->assertSame('Member 14', $r['body'][4]['name']);
        $this->assertCount(3, $this->list('?perPage=3')['body']);
        $this->assertSame([], $this->list('?page=9')['body']);
    }

    public function testSearchByNameAndEmailIsCaseInsensitive(): void
    {
        $r = $this->list('?q=MEMBER 1');
        $this->assertSame('5', $this->total($r));
        $r = $this->list('?q=M07@EXAMPLE');
        $this->assertSame('1', $this->total($r));
        $this->assertSame('Member 07', $r['body'][0]['name']);
    }

    public function testLikeWildcardsAreLiteral(): void
    {
        $this->assertSame('0', $this->total($this->list('?q=%25')));
        $this->assertSame('0', $this->total($this->list('?q=_')));
    }

    public function testRoleFilterAndCombination(): void
    {
        $r = $this->list('?role=member&perPage=100');
        $this->assertSame('7', $this->total($r));
        $this->assertSame(['member'], array_values(array_unique(array_column($r['body'], 'role'))));
        $this->assertSame('1', $this->total($this->list('?role=member&q=Member 04')));
        $this->assertSame('1', $this->total($this->list('?role=admin')));
    }

    #[DataProvider('invalidQueries')]
    public function testInvalidQueryIsRejected(string $query, string $field): void
    {
        $r = $this->list($query);
        $this->assertSame(400, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame($field, $r['body']['field']);
    }

    public static function invalidQueries(): iterable
    {
        yield 'perPage too big' => ['?perPage=101', 'perPage'];
        yield 'perPage zero' => ['?perPage=0', 'perPage'];
        yield 'page zero' => ['?page=0', 'page'];
        yield 'page text' => ['?page=x', 'page'];
        yield 'unknown role' => ['?role=boss', 'role'];
        yield 'array q' => ['?q[]=a', 'q'];
    }
}
