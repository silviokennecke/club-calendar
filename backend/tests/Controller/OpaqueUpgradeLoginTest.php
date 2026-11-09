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

    private const array VARS = ['OPAQUE_ENABLED', 'OPAQUE_ROLLOUT_PERCENT', 'OPAQUE_LEGACY_CUTOFF'];
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

    private function boot(string $enabled, string $percent, string $cutoff = ''): void
    {
        $this->configure(['OPAQUE_ENABLED' => $enabled, 'OPAQUE_ROLLOUT_PERCENT' => $percent, 'OPAQUE_LEGACY_CUTOFF' => $cutoff]);
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

    /** @return iterable<string, array{string, string, bool, bool}> flag, percent, record, expected field */
    public static function matrix(): iterable
    {
        yield 'flag on, 100 %, no record' => ['true', '100', false, true];
        yield 'flag off, 100 %' => ['false', '100', false, false];
        yield 'flag on, 0 %' => ['true', '0', false, false];
        yield 'flag on, 100 %, has record' => ['true', '100', true, false, 409];
        yield 'flag off, has record' => ['false', '100', true, false];
    }

    #[DataProvider('matrix')]
    public function testUpgradeFieldPresence(string $enabled, string $percent, bool $record, bool $expected, int $status = 200): void
    {
        $this->boot($enabled, $percent);
        $user = $this->account($record);

        $r = $this->login();

        self::assertSame($status, $r['status']);
        if (409 === $status) {
            self::assertSame('opaque_required', $r['body']['code']);

            return;
        }
        if (!$expected) {
            self::assertArrayNotHasKey('opaqueUpgrade', $r['body']);

            return;
        }
        self::assertSame(['ticket', 'expiresIn'], array_keys($r['body']['opaqueUpgrade']));
        self::assertSame(300, $r['body']['opaqueUpgrade']['expiresIn']);
        $tickets = static::getContainer()->get(OpaqueUpgradeTickets::class);
        self::assertTrue($tickets->isValid($this->em()->find(User::class, $user->getId()), $r['body']['opaqueUpgrade']['ticket']));
    }

    public function testNoUpgradeForUnconfirmedAddress(): void
    {
        $this->boot('true', '100');
        $this->account(false, false);

        self::assertArrayNotHasKey('opaqueUpgrade', $this->login()['body']);
    }

    public function testPartialRolloutOffersOnlyInsideTheBucket(): void
    {
        $this->boot('true', '50');
        $user = $this->account();
        $inside = static::getContainer()->get(\App\Opaque\OpaqueRollout::class)->bucket($user->getId()) < 50;

        self::assertSame($inside, array_key_exists('opaqueUpgrade', $this->login()['body']));
    }

    public function testLoginIsRefusedAfterTheCutoffWithoutRecord(): void
    {
        $this->boot('true', '100', '2026-12-01');
        static::mockTime('2026-12-01 00:00:00 UTC');
        $this->account();

        $r = $this->login();

        self::assertSame(409, $r['status']);
        self::assertSame('reset_required', $r['body']['code']);
        self::assertArrayNotHasKey('access_token', $r['body']);
    }

    public function testCutoffRefusalDoesNotDependOnThePassword(): void
    {
        $this->boot('true', '100', '2026-12-01');
        static::mockTime('2026-12-02 10:00:00 UTC');
        $this->account();

        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'ada@example.com', 'password' => 'wrong wrong wrong']);

        self::assertSame(409, $r['status']);
    }

    public function testLoginBeforeTheCutoffStillWorks(): void
    {
        $this->boot('true', '100', '2026-12-01');
        static::mockTime('2026-11-30 23:59:59 UTC');
        $this->account();

        self::assertSame(200, $this->login()['status']);
    }

    public function testCutoffDoesNotApplyWhileTheFlagIsOff(): void
    {
        $this->boot('false', '100', '2026-12-01');
        static::mockTime('2026-12-02 00:00:00 UTC');
        $this->account();

        self::assertSame(200, $this->login()['status']);
    }

    public function testUnknownAddressIsStillInvalidCredentialsAfterTheCutoff(): void
    {
        $this->boot('true', '100', '2026-12-01');
        static::mockTime('2026-12-02 00:00:00 UTC');

        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'nobody@example.com', 'password' => self::PASSWORD]);

        self::assertSame(401, $r['status']);
        self::assertSame('invalid_credentials', $r['body']['code']);
    }
}
