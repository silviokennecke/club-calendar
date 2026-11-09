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

/** `passwordProtocol` of GET|PATCH /api/auth/me per account type; GET /api/auth/registration has no `opaqueEnabled` any more. */
class PasswordSignalsTest extends WebTestCase
{
    private const string BCRYPT = '$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

    private KernelBrowser $client;

    protected function setUp(): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        DatabaseResetter::reset($this->em());
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    private function account(string $type): User
    {
        $user = (new User())->setName('Ada')->setEmail('ada@example.com')->setIsEmailVerified(true);
        if (in_array($type, ['record', 'both'], true)) {
            $opaque = new OpaqueTestClient();
            $service = static::getContainer()->get(OpaqueService::class);
            $reg = $opaque->startRegistration('correct horse battery');
            $response = $service->registrationResponse($user, $reg['request']);
            $service->storeRecord($user, $opaque->finishRegistration('correct horse battery', $reg['blind'], $response)['record'], $service->activeKeyId());
        }
        if (in_array($type, ['badkey', 'badkeyhash'], true)) {
            $user->setOpaque(sodium_crypto_scalarmult_ristretto255_base(sodium_crypto_core_ristretto255_scalar_random()).random_bytes(160), 1, 'unknown-key');
        }
        if (in_array($type, ['bcrypt', 'both', 'badkeyhash'], true)) {
            $user->setPassword(self::BCRYPT);
        }
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    /** @return iterable<string, array{string, ?string}> */
    public static function matrix(): iterable
    {
        yield 'record' => ['record', 'opaque'];
        yield 'both' => ['both', 'opaque'];
        yield 'bcrypt' => ['bcrypt', 'legacy'];
        yield 'unknown key id' => ['badkey', 'reset_required'];
        yield 'unknown key id and hash' => ['badkeyhash', 'legacy'];
        yield 'none' => ['none', null];
    }

    #[DataProvider('matrix')]
    public function testMeReportsPasswordProtocol(string $type, ?string $expected): void
    {
        $auth = TestHelper::authHeader($this->account($type), static::getContainer()->get(TokenService::class));

        $get = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $auth);
        self::assertSame(200, $get['status']);
        self::assertArrayHasKey('passwordProtocol', $get['body']);
        self::assertSame($expected, $get['body']['passwordProtocol']);

        $patch = TestHelper::jsonRequest($this->client, 'PATCH', '/api/auth/me', ['name' => 'Ada L'], $auth);
        self::assertSame(200, $patch['status']);
        self::assertSame($expected, $patch['body']['passwordProtocol']);
    }

    public function testRegistrationHasNoOpaqueFlag(): void
    {
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/registration');
        self::assertSame(200, $r['status']);
        self::assertSame(['restricted'], array_keys($r['body']));
    }
}
