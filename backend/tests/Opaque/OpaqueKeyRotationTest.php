<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Entity\User;
use App\Opaque\AuthenticationFailedException;
use App\Opaque\LoginStateSealer;
use App\Opaque\OpaqueKeys;
use App\Opaque\OpaqueReauthTickets;
use App\Opaque\OpaqueService;
use App\Security\NonceStore;
use App\Security\SignedTokenService;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Clock\MockClock;
use Symfony\Component\ErrorHandler\BufferingLogger;

class OpaqueKeyRotationTest extends KernelTestCase
{
    private const string PASSWORD = 'correct horse battery';

    private EntityManagerInterface $em;
    private OpaqueTestClient $client;
    private BufferingLogger $logger;
    private string $legacySeed;
    private string $legacyPrivate;
    private string $newSet;
    private MockClock $clock;
    private NonceStore $nonces;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->client = new OpaqueTestClient();
        $this->logger = new BufferingLogger();
        $this->clock = new MockClock('2026-11-09 12:00:00 UTC');
        $this->nonces = new NonceStore(static::getContainer()->get(Connection::class), $this->clock);
        $this->legacySeed = OpaqueKeys::encode(random_bytes(64));
        $this->legacyPrivate = OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random());
        $this->newSet = '2:'.OpaqueKeys::encode(random_bytes(64)).':'.OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random());
    }

    private function service(string $active = '1', bool $withNew = true): OpaqueService
    {
        $keys = new OpaqueKeys($this->legacySeed, $this->legacyPrivate, $withNew ? $this->newSet : '', $active);
        $tickets = new OpaqueReauthTickets(new SignedTokenService('test-app-secret', $this->clock), $this->nonces);

        return new OpaqueService($keys, new LoginStateSealer('test-app-secret'), $tickets, $this->nonces, $this->clock, $this->em, $this->logger);
    }

    private function register(OpaqueService $service, string $email): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified(true);
        $reg = $this->client->startRegistration(self::PASSWORD);
        $response = $service->registrationResponse($user, $reg['request']);
        $service->storeRecord($user, $this->client->finishRegistration(self::PASSWORD, $reg['blind'], $response)['record'], $service->activeKeyId());
        $this->em->persist($user);
        $this->em->flush();

        return $user;
    }

    private function loginWorks(OpaqueService $service, User $user): bool
    {
        $start = $this->client->startLogin(self::PASSWORD);
        $challenge = $service->startLogin($user, $user->getEmail(), $start['ke1']);
        $ke3 = $this->client->finishLogin(self::PASSWORD, $start, $challenge->ke2)['ke3'] ?? null;
        if (null === $ke3) {
            return false;
        }
        try {
            return $service->finishLogin($challenge->loginState, $ke3)->getId() === $user->getId();
        } catch (AuthenticationFailedException) {
            return false;
        }
    }

    public function testNewRegistrationUsesActiveKeyAndOldRecordStillLogsIn(): void
    {
        $old = $this->register($this->service('1'), 'old@example.com');
        self::assertSame('1', $old->getOpaqueKeyId());

        $rotated = $this->service('2');
        $new = $this->register($rotated, 'new@example.com');
        self::assertSame('2', $new->getOpaqueKeyId());

        self::assertTrue($this->loginWorks($rotated, $old));
        self::assertTrue($this->loginWorks($rotated, $new));
        self::assertSame([], array_filter($this->logger->cleanLogs(), static fn (array $l): bool => 'error' === $l[0]));
    }

    public function testRecordUnderWrongKeyDoesNotLogIn(): void
    {
        $user = $this->register($this->service('1'), 'a@example.com');
        $user->setOpaque((string) $user->getOpaqueRecord(), 1, '2');

        self::assertFalse($this->loginWorks($this->service('2'), $user));
    }

    public function testUnknownKeyIdTakesFakePathAndLogsError(): void
    {
        $service = $this->service('2');
        $user = $this->register($service, 'a@example.com');
        $user->setOpaque((string) $user->getOpaqueRecord(), 1, 'gone');
        $this->logger->cleanLogs();

        self::assertFalse($service->hasRecord($user));
        self::assertFalse($this->loginWorks($service, $user));
        $errors = array_values(array_filter($this->logger->cleanLogs(), static fn (array $l): bool => 'error' === $l[0]));
        self::assertNotEmpty($errors);
        self::assertSame($user->getId(), $errors[0][2]['userId']);
        self::assertStringNotContainsString($this->legacySeed, json_encode($errors));
    }

    public function testNullKeyIdWithRecordIsTreatedAsUnknown(): void
    {
        $service = $this->service('1', false);
        $user = $this->register($service, 'a@example.com');
        $user->setOpaque((string) $user->getOpaqueRecord(), 1, '1');
        $rp = new \ReflectionProperty($user, 'opaqueKeyId');
        $rp->setValue($user, null);

        self::assertFalse($service->hasRecord($user));
    }

    public function testFakePathUsesActiveKey(): void
    {
        $start = $this->client->startLogin(self::PASSWORD);
        $underOne = $this->service('1')->startLogin(null, 'x@example.com', $start['ke1']);
        $underTwo = $this->service('2')->startLogin(null, 'x@example.com', $start['ke1']);

        // The evaluated element (first 32 bytes) depends on the seed of the active key.
        self::assertNotSame(substr($underOne->ke2, 0, 32), substr($underTwo->ke2, 0, 32));
        self::assertSame(strlen($underOne->ke2), strlen($underTwo->ke2));
    }

    public function testSingleKeyEnvKeepsWorkingAsKeyOne(): void
    {
        $service = $this->service('1', false);
        $user = $this->register($service, 'single@example.com');

        self::assertSame('1', $user->getOpaqueKeyId());
        self::assertTrue($this->loginWorks($service, $user));
    }
}
