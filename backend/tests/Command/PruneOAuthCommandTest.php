<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\McpGrant;
use App\Entity\McpToken;
use App\Entity\OAuthAuthorizationCode;
use App\Entity\OAuthAuthorizationRequest;
use App\Entity\OAuthClient;
use App\Entity\User;
use App\Service\Quota;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Persistence of the OAuth/MCP entities (and the migration behind them) and app:prune-oauth. */
class PruneOAuthCommandTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
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

    private function now(string $modify = 'now'): \DateTimeImmutable
    {
        return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->modify($modify);
    }

    private function user(): User
    {
        $user = TestHelper::createUser(self::$em, static::getContainer()->get(UserPasswordHasherInterface::class));

        return $user;
    }

    private function prune(): string
    {
        $t = new CommandTester((new Application(self::$client->getKernel()))->find('app:prune-oauth'));
        $this->assertSame(Command::SUCCESS, $t->execute([]));
        self::$em->clear();

        return $t->getDisplay();
    }

    public function testEntitiesPersistWithUuidIdsAndRelations(): void
    {
        $user = $this->user();
        $client = new OAuthClient('Claude', ['https://claude.ai/api/mcp/auth_callback'], $this->now());
        $grant = new McpGrant($user, $client, 'mcp:read mcp:write', $this->now(), $this->now('+30 days'));
        $request = new OAuthAuthorizationRequest($client, 'https://claude.ai/cb', 'mcp:read', 'challenge', 'st', 'https://x/api/mcp', $this->now());
        $code = new OAuthAuthorizationCode(hash('sha256', 'c'), $grant, 'https://claude.ai/cb', 'challenge', 'https://x/api/mcp', $this->now());
        $token = new McpToken($grant, McpToken::REFRESH, hash('sha256', 't'), $this->now(), $this->now('+7 days'));
        foreach ([$client, $grant, $request, $code, $token] as $e) {
            self::$em->persist($e);
        }
        self::$em->flush();
        self::$em->clear();

        $loaded = self::$em->getRepository(McpToken::class)->findOneBy(['tokenHash' => hash('sha256', 't')]);
        $this->assertInstanceOf(McpToken::class, $loaded);
        $this->assertTrue(\Symfony\Component\Uid\Uuid::isValid($loaded->getId()));
        $this->assertSame($grant->getId(), $loaded->getGrant()->getId());
        $this->assertSame(['https://claude.ai/api/mcp/auth_callback'], $loaded->getGrant()->getClient()->getRedirectUris());
        $this->assertSame(60, $code->getExpiresAt()->getTimestamp() - $code->getCreatedAt()->getTimestamp());
        $this->assertSame(600, $request->getExpiresAt()->getTimestamp() - $request->getCreatedAt()->getTimestamp());
        $this->assertNotNull(self::$em->getRepository(OAuthAuthorizationCode::class)->findOneByHash(hash('sha256', 'c')));
    }

    public function testDeletingTheUserCascadesToGrantsAndTokens(): void
    {
        $user = $this->user();
        $client = new OAuthClient('App', ['https://a.example/cb'], $this->now());
        $grant = new McpGrant($user, $client, 'mcp:read', $this->now(), $this->now('+30 days'));
        self::$em->persist($client);
        self::$em->persist($grant);
        self::$em->persist(new McpToken($grant, McpToken::ACCESS, hash('sha256', 'a'), $this->now(), $this->now('+1 hour')));
        self::$em->flush();

        self::$em->getConnection()->executeStatement('DELETE FROM user WHERE id = ?', [$user->getId()]);
        self::$em->clear();

        $this->assertSame(0, self::$em->getRepository(McpGrant::class)->count([]));
        $this->assertSame(0, self::$em->getRepository(McpToken::class)->count([]));
        $this->assertSame(1, self::$em->getRepository(OAuthClient::class)->count([]));
    }

    public function testPruneDeletesOnlyWhatIsOver(): void
    {
        $user = $this->user();
        $old = $this->now('-40 days');
        $oldUnused = new OAuthClient('Old unused', ['https://a.example/cb'], $old);
        $newUnused = new OAuthClient('New unused', ['https://b.example/cb'], $this->now('-1 day'));
        $oldUsed = new OAuthClient('Old used', ['https://c.example/cb'], $old);
        $live = new McpGrant($user, $oldUsed, 'mcp:read', $old, $this->now('+20 days'));
        $dead = new McpGrant($user, $oldUsed, 'mcp:read', $old, $this->now('-3 days'));
        $revoked = new McpGrant($user, $oldUsed, 'mcp:read', $old, $this->now('+20 days'));
        $revoked->revoke($this->now('-3 days'));
        $freshlyRevoked = new McpGrant($user, $oldUsed, 'mcp:read', $old, $this->now('+20 days'));
        $freshlyRevoked->revoke($this->now('-1 hour'));
        foreach ([$oldUnused, $newUnused, $oldUsed, $live, $dead, $revoked, $freshlyRevoked] as $e) {
            self::$em->persist($e);
        }
        self::$em->persist(new McpToken($live, McpToken::ACCESS, hash('sha256', '1'), $old, $this->now('-2 days')));
        self::$em->persist(new McpToken($live, McpToken::ACCESS, hash('sha256', '2'), $old, $this->now('-1 hour')));
        self::$em->persist(new McpToken($live, McpToken::REFRESH, hash('sha256', '3'), $old, $this->now('+5 days')));
        self::$em->persist(new OAuthAuthorizationCode(hash('sha256', 'x'), $live, 'https://c.example/cb', 'ch', 'r', $this->now('-5 minutes')));
        self::$em->persist(new OAuthAuthorizationCode(hash('sha256', 'y'), $live, 'https://c.example/cb', 'ch', 'r', $this->now()));
        self::$em->persist(new OAuthAuthorizationRequest($newUnused, 'https://b.example/cb', 'mcp:read', 'ch', null, 'r', $this->now('-20 minutes')));
        self::$em->persist(new OAuthAuthorizationRequest($newUnused, 'https://b.example/cb', 'mcp:read', 'ch', null, 'r', $this->now()));
        self::$em->flush();
        self::$em->clear();

        $this->prune();

        $names = array_map(static fn (OAuthClient $c) => $c->getClientName(), self::$em->getRepository(OAuthClient::class)->findAll());
        sort($names);
        $this->assertSame(['New unused', 'Old used'], $names);
        $this->assertEqualsCanonicalizing(
            [$live->getId(), $freshlyRevoked->getId()],
            array_map(static fn (McpGrant $g) => $g->getId(), self::$em->getRepository(McpGrant::class)->findAll()),
        );
        $this->assertEqualsCanonicalizing(
            [hash('sha256', '2'), hash('sha256', '3')],
            array_map(static fn (McpToken $t) => $t->getTokenHash(), self::$em->getRepository(McpToken::class)->findAll()),
        );
        $this->assertSame(1, self::$em->getRepository(OAuthAuthorizationCode::class)->count([]));
        $this->assertSame(1, self::$em->getRepository(OAuthAuthorizationRequest::class)->count([]));
    }

    public function testQuotaConstantCountsGrantsPerUser(): void
    {
        $this->assertSame(20, Quota::LIMITS[Quota::MCP_CLIENTS_PER_USER]);
        $user = $this->user();
        $quota = static::getContainer()->get(Quota::class);
        $client = new OAuthClient('App', ['https://a.example/cb'], $this->now());
        self::$em->persist($client);
        for ($i = 0; $i < 19; ++$i) {
            self::$em->persist(new McpGrant($user, $client, 'mcp:read', $this->now(), $this->now('+1 day')));
        }
        self::$em->flush();

        $quota->assertRoom(Quota::MCP_CLIENTS_PER_USER, $user);
        $this->expectException(\App\Exception\ApiProblemException::class);
        $quota->assertRoom(Quota::MCP_CLIENTS_PER_USER, $user, 2);
    }
}
