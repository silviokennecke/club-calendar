<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Opaque\OpaqueService;
use App\Service\ClubInvitationService;
use App\Service\RegistrationPolicy;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use App\Tests\Opaque\OpaqueTestClient;
use Doctrine\ORM\EntityManagerInterface;
use Monolog\Handler\TestHandler;
use Monolog\Logger;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** `auth` of POST /api/auth/identify for every account type, flag, rollout and cutoff; AP 9 log lines. */
class OpaqueIdentifyTest extends WebTestCase
{
    private const array VARS = ['OPAQUE_ENABLED', 'OPAQUE_ROLLOUT_PERCENT', 'OPAQUE_LEGACY_CUTOFF'];
    private const string BCRYPT = '$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';

    private KernelBrowser $client;
    private OpaqueTestClient $opaque;
    /** @var array<string, string|null> */
    private array $saved = [];

    protected function setUp(): void
    {
        foreach (self::VARS as $name) {
            $this->saved[$name] = $_SERVER[$name] ?? null;
        }
        $this->opaque = new OpaqueTestClient();
    }

    protected function tearDown(): void
    {
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

    private function boot(string $enabled, string $percent = '0', string $cutoff = '', bool $restricted = false): void
    {
        $this->configure(['OPAQUE_ENABLED' => $enabled, 'OPAQUE_ROLLOUT_PERCENT' => $percent, 'OPAQUE_LEGACY_CUTOFF' => $cutoff]);
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = static::getContainer();
        $container->set(RegistrationPolicy::class, new RegistrationPolicy($container->get(ClubInvitationService::class), $restricted));
        DatabaseResetter::reset($this->em());
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    /** @param 'record'|'bcrypt'|'both'|'none'|'corrupt' $type */
    private function account(string $type, string $email, bool $real = false): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified(true);
        if (in_array($type, ['record', 'both'], true) && !$real) {
            // Well-formed but not usable for a login; works with the flag off, where no server can be built.
            $user->setOpaque(sodium_crypto_scalarmult_ristretto255_base(sodium_crypto_core_ristretto255_scalar_random()).random_bytes(160), 1, '1');
        } elseif (in_array($type, ['record', 'both'], true)) {
            $service = static::getContainer()->get(OpaqueService::class);
            $reg = $this->opaque->startRegistration('correct horse battery');
            $response = $service->registrationResponse($user, $reg['request']);
            $service->storeRecord($user, $this->opaque->finishRegistration('correct horse battery', $reg['blind'], $response)['record']);
        }
        if (in_array($type, ['bcrypt', 'both'], true)) {
            $user->setPassword(self::BCRYPT);
        }
        if ('corrupt' === $type) {
            $user->setOpaque(str_repeat("\x01", 192), 1, '1');
        }
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    /** @return array{status: string, auth: string} */
    private function identify(string $email): array
    {
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/identify', ['email' => $email]);
        self::assertSame(200, $r['status']);

        return ['status' => $r['body']['status'], 'auth' => $r['body']['auth']];
    }

    /** @return iterable<string, array{string, string, string, string, string}> type, enabled, percent, cutoff, expected auth */
    public static function matrix(): iterable
    {
        $past = '2000-01-01';
        $future = '2999-01-01';
        foreach (['0', '50', '100'] as $percent) {
            // The percentage only gates the upgrade offer, never the answer of identify.
            yield "record, flag on, $percent%" => ['record', 'true', $percent, '', 'opaque'];
            yield "both, flag on, $percent%" => ['both', 'true', $percent, $past, 'opaque'];
            yield "bcrypt, flag on, $percent%" => ['bcrypt', 'true', $percent, '', 'legacy'];
            yield "none, flag on, $percent%" => ['none', 'true', $percent, $past, 'none'];
        }
        yield 'bcrypt, flag on, cutoff future' => ['bcrypt', 'true', '100', $future, 'legacy'];
        yield 'bcrypt, flag on, cutoff passed' => ['bcrypt', 'true', '100', $past, 'reset_required'];
        yield 'bcrypt, flag off, cutoff passed' => ['bcrypt', 'false', '100', $past, 'legacy'];
        yield 'bcrypt, flag off' => ['bcrypt', 'false', '0', '', 'legacy'];
        yield 'record only, flag off' => ['record', 'false', '100', '', 'reset_required'];
        yield 'both, flag off' => ['both', 'false', '100', '', 'legacy'];
        yield 'none, flag off' => ['none', 'false', '0', '', 'none'];
        yield 'corrupt record only, flag on' => ['corrupt', 'true', '0', '', 'reset_required'];
    }

    #[DataProvider('matrix')]
    public function testAuthForExistingAccount(string $type, string $enabled, string $percent, string $cutoff, string $expected): void
    {
        $this->boot($enabled, $percent, $cutoff);
        $this->account($type, 'ada@example.com');

        self::assertSame(['status' => 'login', 'auth' => $expected], $this->identify('ada@example.com'));
    }

    public function testSignupProtocolFollowsTheFlagOnly(): void
    {
        $this->boot('true', '0');
        self::assertSame(['status' => 'register', 'auth' => 'opaque'], $this->identify('new@example.com'));
        $this->boot('false', '100');
        self::assertSame(['status' => 'register', 'auth' => 'legacy'], $this->identify('new@example.com'));
        $this->boot('true', '0', '', true);
        self::assertSame(['status' => 'registration_restricted', 'auth' => 'opaque'], $this->identify('new@example.com'));
        $this->boot('false', '0', '', true);
        self::assertSame(['status' => 'registration_restricted', 'auth' => 'legacy'], $this->identify('new@example.com'));
    }

    public function testLegacyLoginRejectsRecordOnlyAccountCleanlyAndLogsNoAddress(): void
    {
        $this->boot('true');
        $user = $this->account('record', 'ada@example.com');
        $handler = $this->captureLogs();

        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'ada@example.com', 'password' => 'correct horse battery']);

        self::assertSame(409, $r['status']);
        self::assertSame('opaque_required', $r['body']['code']);
        $record = $this->find($handler, 'opaque.legacy_login.failure');
        self::assertSame($user->getId(), $record->context['userId']);
        self::assertStringNotContainsString('ada@example.com', $this->dump($handler));
    }

    public function testResetRequiredIsLoggedWithUserIdOnly(): void
    {
        $this->boot('true', '0', '2000-01-01');
        $user = $this->account('bcrypt', 'ada@example.com');
        $handler = $this->captureLogs();

        $this->identify('ada@example.com');

        $record = $this->find($handler, 'opaque.identify.reset_required');
        self::assertSame(['userId' => $user->getId(), 'reason' => 'cutoff'], $record->context);
        self::assertStringNotContainsString('ada@example.com', $this->dump($handler));
    }

    public function testLegacyLoginSuccessLogsUpgradeOffer(): void
    {
        $this->boot('true', '100');
        $user = (new User())->setName('Ada')->setEmail('ada@example.com')->setIsEmailVerified(true);
        $user->setPassword(static::getContainer()->get('security.user_password_hasher')->hashPassword($user, 'secret-pass-1'));
        $this->em()->persist($user);
        $this->em()->flush();
        $handler = $this->captureLogs();

        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'ada@example.com', 'password' => 'secret-pass-1']);

        self::assertSame(200, $r['status']);
        $record = $this->find($handler, 'opaque.legacy_login.success');
        self::assertSame(['userId' => $user->getId(), 'hasRecord' => false, 'upgradeOffered' => true], $record->context);
    }

    public function testOpaqueLoginSuccessAndFailureAreLogged(): void
    {
        $this->boot('true');
        $user = $this->account('record', 'ada@example.com', true);
        $handler = $this->captureLogs();

        $ke1 = $this->opaque->startLogin('correct horse battery');
        $start = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/opaque/login/start', [
            'email' => 'ada@example.com',
            'startLoginRequest' => \App\Opaque\Base64Url::encode($ke1['ke1']),
        ]);
        $ke3 = $this->opaque->finishLogin('correct horse battery', $ke1, \App\Opaque\Base64Url::decode($start['body']['loginResponse']) ?? '')['ke3'];
        $finish = fn (string $state, string $ke3) => TestHelper::jsonRequest($this->client, 'POST', '/api/auth/opaque/login/finish', [
            'loginState' => $state,
            'finishLoginRequest' => \App\Opaque\Base64Url::encode($ke3),
        ]);

        self::assertSame(200, $finish($start['body']['loginState'], $ke3)['status']);
        self::assertSame(['userId' => $user->getId()], $this->find($handler, 'opaque.login.success')->context);

        self::assertSame(401, $finish($start['body']['loginState'], $ke3)['status']);
        self::assertSame(['reason' => 'invalid_state'], $this->find($handler, 'opaque.login.failure')->context);
        self::assertStringNotContainsString('ada@example.com', $this->dump($handler));
    }

    public function testOperatorSetPasswordDropsTheStaleRecord(): void
    {
        $this->boot('false');
        $user = $this->account('record', 'ada@example.com');

        static::getContainer()->get(\App\Service\AccountService::class)->setPasswordAsOperator($user, 'a-new-password-1');

        $this->em()->clear();
        self::assertSame(['status' => 'login', 'auth' => 'legacy'], $this->identify('ada@example.com'));
        self::assertNull($this->em()->getRepository(User::class)->findOneBy(['email' => 'ada@example.com'])->getOpaqueRecord());
    }

    private function captureLogs(): TestHandler
    {
        $logger = static::getContainer()->get(LoggerInterface::class);
        self::assertInstanceOf(Logger::class, $logger);
        $logger->pushHandler($handler = new TestHandler());

        return $handler;
    }

    private function find(TestHandler $handler, string $message): \Monolog\LogRecord
    {
        foreach ($handler->getRecords() as $record) {
            if ($record->message === $message) {
                return $record;
            }
        }
        self::fail("No log line '$message'; got: ".implode(', ', array_map(static fn ($r) => $r->message, $handler->getRecords())));
    }

    private function dump(TestHandler $handler): string
    {
        return json_encode(array_map(static fn ($r) => [$r->message, $r->context], $handler->getRecords()), JSON_THROW_ON_ERROR);
    }
}
