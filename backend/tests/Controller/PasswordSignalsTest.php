<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Opaque\OpaqueService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use App\Tests\Opaque\OpaqueTestClient;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** `passwordProtocol` of GET|PATCH /api/auth/me per account type and flag; `opaqueEnabled` of GET /api/auth/registration. */
class PasswordSignalsTest extends WebTestCase
{
    private const string BCRYPT = '$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

    private KernelBrowser $client;
    private ?string $saved;

    protected function setUp(): void
    {
        $this->saved = $_SERVER['OPAQUE_ENABLED'] ?? null;
    }

    protected function tearDown(): void
    {
        $this->setFlag($this->saved);
    }

    private function setFlag(?string $value): void
    {
        if (null === $value) {
            unset($_SERVER['OPAQUE_ENABLED'], $_ENV['OPAQUE_ENABLED']);
            putenv('OPAQUE_ENABLED');
        } else {
            $_SERVER['OPAQUE_ENABLED'] = $_ENV['OPAQUE_ENABLED'] = $value;
            putenv("OPAQUE_ENABLED=$value");
        }
    }

    private function boot(string $enabled): void
    {
        $this->setFlag($enabled);
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        DatabaseResetter::reset($this->em());
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    private function account(string $type, bool $real = true): User
    {
        $user = (new User())->setName('Ada')->setEmail('ada@example.com')->setIsEmailVerified(true);
        if (in_array($type, ['record', 'both'], true) && !$real) {
            // No server can be built with the flag off: store a well-formed but unusable record.
            $user->setOpaque(sodium_crypto_scalarmult_ristretto255_base(sodium_crypto_core_ristretto255_scalar_random()).random_bytes(160), 1, '1');
        } elseif (in_array($type, ['record', 'both'], true)) {
            $opaque = new OpaqueTestClient();
            $service = static::getContainer()->get(OpaqueService::class);
            $reg = $opaque->startRegistration('correct horse battery');
            $response = $service->registrationResponse($user, $reg['request']);
            $service->storeRecord($user, $opaque->finishRegistration('correct horse battery', $reg['blind'], $response)['record']);
        }
        if (in_array($type, ['bcrypt', 'both'], true)) {
            $user->setPassword(self::BCRYPT);
        }
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    /** @return iterable<string, array{string, string, ?string}> */
    public static function matrix(): iterable
    {
        yield 'record, flag on' => ['record', 'true', 'opaque'];
        yield 'both, flag on' => ['both', 'true', 'opaque'];
        yield 'bcrypt, flag on' => ['bcrypt', 'true', 'legacy'];
        yield 'both, flag off' => ['both', 'false', 'legacy'];
        yield 'bcrypt, flag off' => ['bcrypt', 'false', 'legacy'];
        yield 'none, flag on' => ['none', 'true', null];
        yield 'none, flag off' => ['none', 'false', null];
    }

    #[DataProvider('matrix')]
    public function testMeReportsPasswordProtocol(string $type, string $enabled, ?string $expected): void
    {
        $this->boot($enabled);
        $auth = TestHelper::authHeader($this->account($type, 'true' === $enabled), static::getContainer()->get(TokenService::class));

        $get = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $auth);
        self::assertSame(200, $get['status']);
        self::assertArrayHasKey('passwordProtocol', $get['body']);
        self::assertSame($expected, $get['body']['passwordProtocol']);

        $patch = TestHelper::jsonRequest($this->client, 'PATCH', '/api/auth/me', ['name' => 'Ada L'], $auth);
        self::assertSame(200, $patch['status']);
        self::assertSame($expected, $patch['body']['passwordProtocol']);
    }

    public function testRecordOnlyAccountWithFlagOffHasNoUsableProtocol(): void
    {
        $this->boot('false');
        $auth = TestHelper::authHeader($this->account('record', false), static::getContainer()->get(TokenService::class));

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $auth);
        self::assertNull($r['body']['passwordProtocol']);
    }

    #[DataProvider('flags')]
    public function testRegistrationReportsFlag(string $enabled, bool $expected): void
    {
        $this->boot($enabled);

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/registration');
        self::assertSame(200, $r['status']);
        self::assertSame($expected, $r['body']['opaqueEnabled']);
        self::assertSame(['restricted', 'opaqueEnabled'], array_keys($r['body']));
    }

    /** @return iterable<string, array{string, bool}> */
    public static function flags(): iterable
    {
        yield 'on' => ['true', true];
        yield 'off' => ['false', false];
    }
}
