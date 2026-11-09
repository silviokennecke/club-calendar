<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Opaque\OpaqueUpgradeTickets;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** AP 14: `opaqueUpgrade` in the legacy login response and the login refusal after the cutoff. */
class OpaqueUpgradeLoginTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const array VARS = ['OPAQUE_LEGACY_CUTOFF'];
    private const string PASSWORD = 'correct horse battery';

    private KernelBrowser $client;
    /** @var array<string, string|null> */
    private array $saved = [];

    protected function setUp(): void
    {
        foreach (self::VARS as $name) {
            $this->saved[$name] = $_SERVER[$name] ?? null;
        }
    }

    protected function tearDown(): void
    {
        static::mockTime(false);
        $this->configure($this->saved);
    }

    /** @param array<string, string|null> $env */
    private function configure(array $env): void
    {
        foreach ($env as $name => $value) {
            if (null === $value) {
                unset($_SERVER[$name], $_ENV[$name]);
                putenv($name);
            } else {
                $_SERVER[$name] = $_ENV[$name] = $value;
                putenv("$name=$value");
            }
        }
    }

    private function boot(string $cutoff = ''): void
    {
        $this->configure(['OPAQUE_LEGACY_CUTOFF' => $cutoff]);
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        DatabaseResetter::reset($this->em());
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    private function account(bool $record = false, bool $verified = true): User
    {
        $user = TestHelper::createUser($this->em(), static::getContainer()->get(UserPasswordHasherInterface::class), 'ada@example.com', self::PASSWORD, $verified);
        if ($record) {
            $user->setOpaque(sodium_crypto_scalarmult_ristretto255_base(sodium_crypto_core_ristretto255_scalar_random()).random_bytes(160), 1, '1');
            $this->em()->flush();
        }

        return $user;
    }

    /** @return array{status: int, body: array<string, mixed>} */
    private function login(): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'ada@example.com', 'password' => self::PASSWORD]);
    }

    /** @return iterable<string, array{string, bool}> cutoff, record */
    public static function matrix(): iterable
    {
        yield 'no cutoff, no record' => ['', false];
        yield 'future cutoff, no record' => ['2999-01-01', false];
        yield 'no cutoff, has record' => ['', true];
    }

    #[DataProvider('matrix')]
    public function testUpgradeIsOfferedToEveryLegacyAccount(string $cutoff, bool $record): void
    {
        $this->boot($cutoff);
        $user = $this->account($record);

        $r = $this->login();

        if ($record) {
            self::assertSame(409, $r['status']);
            self::assertSame('opaque_required', $r['body']['code']);

            return;
        }
        self::assertSame(200, $r['status']);
        self::assertSame(['ticket', 'expiresIn'], array_keys($r['body']['opaqueUpgrade']));
        self::assertSame(300, $r['body']['opaqueUpgrade']['expiresIn']);
        $tickets = static::getContainer()->get(OpaqueUpgradeTickets::class);
        self::assertTrue($tickets->isValid($this->em()->find(User::class, $user->getId()), $r['body']['opaqueUpgrade']['ticket']));
    }

    public function testEveryLegacyAccountGetsATicket(): void
    {
        $this->boot();
        $em = $this->em();
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        foreach (range(1, 12) as $i) {
            TestHelper::createUser($em, $hasher, "user$i@example.com", self::PASSWORD, true);
        }

        foreach (range(1, 12) as $i) {
            $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => "user$i@example.com", 'password' => self::PASSWORD]);
            self::assertArrayHasKey('opaqueUpgrade', $r['body'], "user$i");
        }
    }

    public function testNoUpgradeForUnconfirmedAddress(): void
    {
        $this->boot();
        $this->account(false, false);

        self::assertArrayNotHasKey('opaqueUpgrade', $this->login()['body']);
    }

    public function testLoginIsRefusedAfterTheCutoffWithoutRecord(): void
    {
        $this->boot('2026-12-01');
        static::mockTime('2026-12-01 00:00:00 UTC');
        $this->account();

        $r = $this->login();

        self::assertSame(409, $r['status']);
        self::assertSame('reset_required', $r['body']['code']);
        self::assertArrayNotHasKey('access_token', $r['body']);
    }

    public function testCutoffRefusalDoesNotDependOnThePassword(): void
    {
        $this->boot('2026-12-01');
        static::mockTime('2026-12-02 10:00:00 UTC');
        $this->account();

        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'ada@example.com', 'password' => 'wrong wrong wrong']);

        self::assertSame(409, $r['status']);
    }

    public function testLoginBeforeTheCutoffStillWorks(): void
    {
        $this->boot('2026-12-01');
        static::mockTime('2026-11-30 23:59:59 UTC');
        $this->account();

        self::assertSame(200, $this->login()['status']);
    }

    public function testUnknownAddressIsStillInvalidCredentialsAfterTheCutoff(): void
    {
        $this->boot('2026-12-01');
        static::mockTime('2026-12-02 00:00:00 UTC');

        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'nobody@example.com', 'password' => self::PASSWORD]);

        self::assertSame(401, $r['status']);
        self::assertSame('invalid_credentials', $r['body']['code']);
    }
}
