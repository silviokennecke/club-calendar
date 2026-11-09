<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Entity\User;
use App\Opaque\AuthenticationFailedException;
use App\Opaque\InvalidMessageException;
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

class OpaqueServiceTest extends KernelTestCase
{
    private const string PASSWORD = 'correct horse battery';
    private const string SECRET = 'test-app-secret';

    private EntityManagerInterface $em;
    private MockClock $clock;
    private OpaqueService $service;
    private OpaqueReauthTickets $tickets;
    private OpaqueTestClient $client;
    private BufferingLogger $logger;
    private OpaqueKeys $keys;
    private NonceStore $nonces;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->clock = new MockClock('2026-11-09 12:00:00 UTC');
        $this->client = new OpaqueTestClient();

        $this->keys = new OpaqueKeys(true, OpaqueKeys::encode(random_bytes(64)), OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()));
        $this->nonces = new NonceStore(static::getContainer()->get(Connection::class), $this->clock);
        $this->logger = new BufferingLogger();
        $this->tickets = new OpaqueReauthTickets(new SignedTokenService(self::SECRET, $this->clock), $this->nonces);
        $this->service = $this->makeService(self::SECRET);
    }

    private function makeService(string $secret, ?OpaqueKeys $keys = null): OpaqueService
    {
        return new OpaqueService($keys ?? $this->keys, new LoginStateSealer($secret), $this->tickets, $this->nonces, $this->clock, $this->em, $this->logger);
    }

    private function user(string $email = 'ada@example.com', bool $withRecord = true): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified(true);
        if ($withRecord) {
            $reg = $this->client->startRegistration(self::PASSWORD);
            $response = $this->service->registrationResponse($user, $reg['request']);
            $this->service->storeRecord($user, $this->client->finishRegistration(self::PASSWORD, $reg['blind'], $response)['record']);
        }
        $this->em->persist($user);
        $this->em->flush();

        return $user;
    }

    /** @return array{0: \App\Opaque\OpaqueLoginChallenge, 1: ?string} challenge and KE3 (null when the client rejects KE2) */
    private function login(?User $user, string $email, string $password = self::PASSWORD, ?string $purpose = null): array
    {
        $start = $this->client->startLogin($password);
        $challenge = null === $purpose ? $this->service->startLogin($user, $email, $start['ke1']) : $this->service->startReauth($user, $purpose, $start['ke1']);

        return [$challenge, $this->client->finishLogin($password, $start, $challenge->ke2)['ke3'] ?? null];
    }

    public function testRegisterThenLoginRoundTrip(): void
    {
        $user = $this->user();
        $this->em->clear();
        $user = $this->em->find(User::class, $user->getId());

        self::assertTrue($this->service->hasRecord($user));
        self::assertSame(1, $user->getOpaqueVersion());
        self::assertSame('1', $user->getOpaqueKeyId());
        self::assertSame(192, strlen((string) $user->getOpaqueRecord()));

        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        self::assertNotNull($ke3);
        self::assertSame('memory-constrained', $challenge->ksfProfile);
        self::assertSame($user->getId(), $this->service->finishLogin($challenge->loginState, $ke3)->getId());
    }

    public function testWrongPasswordFails(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com', 'wrong password');

        // The client already cannot open the envelope; a forged KE3 must fail on the server as well.
        self::assertNull($ke3);
        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($challenge->loginState, random_bytes(64));
    }

    public function testUnknownAddressTakesFakePathWithSameShapeAndAlwaysFails(): void
    {
        $user = $this->user();
        [$real] = $this->login($user, 'ada@example.com');
        [$fake, $ke3] = $this->login(null, 'nobody@example.com');

        self::assertNull($ke3);
        self::assertSame(strlen($real->ke2), strlen($fake->ke2));
        self::assertSame(strlen($real->loginState), strlen($fake->loginState));
        self::assertSame($real->ksfProfile, $fake->ksfProfile);

        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($fake->loginState, random_bytes(64));
    }

    public function testFakeIdentifierIsStablePerAddress(): void
    {
        $start = $this->client->startLogin(self::PASSWORD);
        $a = $this->service->startLogin(null, 'Nobody@Example.com', $start['ke1']);
        $b = $this->service->startLogin(null, ' nobody@example.com ', $start['ke1']);

        // Same blinded element, same fake identifier: identical evaluated element.
        self::assertSame(substr($a->ke2, 0, 32), substr($b->ke2, 0, 32));
        $c = $this->service->startLogin(null, 'other@example.com', $start['ke1']);
        self::assertNotSame(substr($a->ke2, 0, 32), substr($c->ke2, 0, 32));
    }

    public function testLegacyUserWithoutRecordIsIndistinguishableFromUnknown(): void
    {
        $legacy = $this->user('legacy@example.com', false);
        $legacy->setPassword('$2y$13$legacyhash');
        self::assertFalse($this->service->hasRecord($legacy));

        $start = $this->client->startLogin(self::PASSWORD);
        $asLegacy = $this->service->startLogin($legacy, 'legacy@example.com', $start['ke1']);
        $asUnknown = $this->service->startLogin(null, 'legacy@example.com', $start['ke1']);

        // Existing account without record: user id as OPRF identifier (stable once it registers), unknown: fake:email.
        self::assertNotSame(substr($asLegacy->ke2, 0, 32), substr($asUnknown->ke2, 0, 32));
        self::assertSame(strlen($asUnknown->ke2), strlen($asLegacy->ke2));
        self::assertSame(strlen($asUnknown->loginState), strlen($asLegacy->loginState));
        self::assertSame($asUnknown->ksfProfile, $asLegacy->ksfProfile);
        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($asLegacy->loginState, random_bytes(64));
    }

    public function testCorruptRecordFallsBackToFakePath(): void
    {
        $user = $this->user();
        $user->setOpaque(str_repeat("\1", 192), 1, '1');
        self::assertFalse($this->service->hasRecord($user));
        [, $ke3] = $this->login($user, 'ada@example.com');
        self::assertNull($ke3);
        $logs = $this->logger->cleanLogs();
        self::assertNotEmpty($logs);
        self::assertSame('error', $logs[0][0]);
        self::assertStringNotContainsString(str_repeat("\1", 8), json_encode($logs[0][2]['userId'] ?? ''));
    }

    public function testLegacyOprfOutputMatchesLaterRecordRegistration(): void
    {
        $user = $this->user('late@example.com', false);
        $start = $this->client->startLogin(self::PASSWORD);
        $asLegacy = $this->service->startLogin($user, 'late@example.com', $start['ke1']);
        $reg = $this->service->registrationResponse($user, substr($start['ke1'], 0, 32));

        self::assertSame(substr($asLegacy->ke2, 0, 32), substr($reg, 0, 32));
    }

    public function testServiceServerUsesSystemRandom(): void
    {
        $server = (new \ReflectionMethod($this->service, 'server'))->invoke($this->service, '1');
        self::assertInstanceOf(\App\Opaque\SystemRandom::class, (new \ReflectionProperty($server, 'random'))->getValue($server));
    }

    public function testCorruptRecordLogsOncePerAttempt(): void
    {
        $user = $this->user();
        $user->setOpaque(str_repeat("\1", 192), 1, '1');
        $this->logger->cleanLogs();
        $this->login($user, 'ada@example.com');
        self::assertCount(1, $this->logger->cleanLogs());
    }

    public function testRealAndFakeStatesHaveEqualSize(): void
    {
        $user = $this->user();
        $start = $this->client->startLogin(self::PASSWORD);
        $real = $this->service->startLogin($user, 'ada@example.com', $start['ke1']);
        $fake = $this->service->startLogin(null, 'nobody@example.com', $start['ke1']);

        self::assertSame(strlen($real->loginState), strlen($fake->loginState));
    }

    public function testFakeFlaggedStateFailsEvenWithValidMac(): void
    {
        $mac = random_bytes(64);
        $sealer = new LoginStateSealer(self::SECRET);
        $blob = $sealer->seal(new \App\Opaque\ServerLoginState(random_bytes(64), $mac), OpaqueService::PURPOSE_LOGIN, null, 0, str_repeat("\0", 32), $this->clock->now()->getTimestamp() + 60);

        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($blob, $mac);
    }

    public function testStateEndsWhenSessionsEndInBetween(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $user->invalidateTokens();
        $this->em->flush();

        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($challenge->loginState, $ke3);
    }

    public function testStateEndsWhenRecordChangesInBetween(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $reg = $this->client->startRegistration('new password');
        $this->service->storeRecord($user, $this->client->finishRegistration('new password', $reg['blind'], $this->service->registrationResponse($user, $reg['request']))['record']);
        $this->em->flush();

        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($challenge->loginState, $ke3);
    }

    public function testStateEndsWhenUserIsDeletedInBetween(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $this->em->remove($user);
        $this->em->flush();

        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishLogin($challenge->loginState, $ke3);
    }

    public function testStoreRecordRejectsWrongLength(): void
    {
        $this->expectException(InvalidMessageException::class);
        $this->service->storeRecord(new User(), 'short');
    }

    public function testReplayedStateIsRejected(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        self::assertSame($user->getId(), $this->service->finishLogin($challenge->loginState, $ke3)->getId());

        $this->expectException(InvalidMessageException::class);
        $this->service->finishLogin($challenge->loginState, $ke3);
    }

    public function testWrongKe3BurnsTheState(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        try {
            $this->service->finishLogin($challenge->loginState, random_bytes(64));
            self::fail('expected failure');
        } catch (AuthenticationFailedException) {
        }

        $this->expectException(InvalidMessageException::class);
        $this->service->finishLogin($challenge->loginState, $ke3);
    }

    public function testExpiredStateIsRejected(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $this->clock->modify('+'.(OpaqueService::STATE_TTL + 1).' seconds');

        $this->expectException(InvalidMessageException::class);
        $this->service->finishLogin($challenge->loginState, $ke3);
    }

    public function testStateStillValidAtTtl(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $this->clock->modify('+'.OpaqueService::STATE_TTL.' seconds');

        self::assertSame($user->getId(), $this->service->finishLogin($challenge->loginState, $ke3)->getId());
    }

    public function testTamperedBlobIsRejected(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $blob = $challenge->loginState;
        $flipped = $blob;
        $flipped[40] = 'A' === $flipped[40] ? 'B' : 'A';

        foreach ([$flipped, substr($blob, 0, -4), $blob.'AAAA', '', 'not base64!'] as $bad) {
            try {
                $this->service->finishLogin($bad, $ke3);
                self::fail('expected rejection');
            } catch (InvalidMessageException) {
            }
        }
        // The untouched blob still works: tampering consumed nothing.
        self::assertSame($user->getId(), $this->service->finishLogin($blob, $ke3)->getId());
    }

    public function testBlobFromAnotherSecretIsRejected(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com');
        $other = $this->makeService('another-secret');

        $this->expectException(InvalidMessageException::class);
        $other->finishLogin($challenge->loginState, $ke3);
    }

    public function testPurposeMismatchIsRejectedBothWays(): void
    {
        $user = $this->user();
        [$login, $loginKe3] = $this->login($user, 'ada@example.com');
        [$reauth, $reauthKe3] = $this->login($user, 'ada@example.com', purpose: OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT);

        try {
            $this->service->finishReauth($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT, $login->loginState, $loginKe3);
            self::fail('login state used for reauth');
        } catch (InvalidMessageException) {
        }
        try {
            $this->service->finishLogin($reauth->loginState, $reauthKe3);
            self::fail('reauth state used for login');
        } catch (InvalidMessageException) {
        }
        try {
            $this->service->finishReauth($user, OpaqueReauthTickets::PURPOSE_CHANGE_EMAIL, $reauth->loginState, $reauthKe3);
            self::fail('reauth state used for another ticket purpose');
        } catch (InvalidMessageException) {
        }

        // The mismatches did not consume the states.
        self::assertSame($user->getId(), $this->service->finishLogin($login->loginState, $loginKe3)->getId());
        self::assertNotSame('', $this->service->finishReauth($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT, $reauth->loginState, $reauthKe3));
    }

    public function testReauthStateOfAnotherUserIsRejected(): void
    {
        $user = $this->user();
        $other = $this->user('bob@example.com');
        [$challenge, $ke3] = $this->login($user, 'ada@example.com', purpose: OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER);

        $this->expectException(AuthenticationFailedException::class);
        $this->service->finishReauth($other, OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER, $challenge->loginState, $ke3);
    }

    public function testReauthTicketIssueAndConsume(): void
    {
        $user = $this->user();
        [$challenge, $ke3] = $this->login($user, 'ada@example.com', purpose: OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT);
        $ticket = $this->service->finishReauth($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT, $challenge->loginState, $ke3);

        self::assertTrue($this->tickets->consume($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT, $ticket));
        self::assertFalse($this->tickets->consume($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT, $ticket), 'replay');
    }

    public function testReauthTicketBindings(): void
    {
        $user = $this->user();
        $other = $this->user('bob@example.com');
        $purpose = OpaqueReauthTickets::PURPOSE_CHANGE_EMAIL;
        $ticket = $this->tickets->issue($user, $purpose);

        self::assertFalse($this->tickets->consume($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT, $ticket), 'purpose');
        self::assertFalse($this->tickets->consume($other, $purpose, $ticket), 'user');
        self::assertFalse($this->tickets->consume($user, $purpose, $ticket.'x'), 'forged');
        self::assertFalse($this->tickets->consume($user, $purpose, 'garbage'), 'garbage');

        $user->invalidateTokens();
        self::assertFalse($this->tickets->consume($user, $purpose, $ticket), 'token version bump');
    }

    public function testReauthTicketExpires(): void
    {
        $user = $this->user();
        $ticket = $this->tickets->issue($user, OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER);

        $this->clock->modify('+'.(OpaqueReauthTickets::TTL + 1).' seconds');
        self::assertFalse($this->tickets->consume($user, OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER, $ticket));
    }

    public function testReauthTicketAcceptedWithinTtl(): void
    {
        $user = $this->user();
        $ticket = $this->tickets->issue($user, OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER);

        $this->clock->modify('+'.OpaqueReauthTickets::TTL.' seconds');
        self::assertTrue($this->tickets->consume($user, OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER, $ticket));
    }

    public function testUnknownTicketPurposeCannotBeIssued(): void
    {
        $this->expectException(\App\Opaque\OpaqueException::class);
        $this->tickets->issue($this->user(), 'login');
    }

    public function testMigrationColumnsExist(): void
    {
        $columns = static::getContainer()->get(Connection::class)->createSchemaManager()->listTableColumns('user');
        foreach (['opaque_record', 'opaque_version', 'opaque_key_id'] as $name) {
            self::assertArrayHasKey($name, $columns);
            self::assertFalse($columns[$name]->getNotnull());
        }
        self::assertSame(256, $columns['opaque_record']->getLength());
    }

    public function testDisabledKeysFailOnUse(): void
    {
        $service = $this->makeService(self::SECRET, new OpaqueKeys(false, '', ''));

        self::assertFalse($service->isEnabled());
        $this->expectException(\App\Opaque\OpaqueException::class);
        $service->startLogin(null, 'a@example.com', $this->client->startLogin('x')['ke1']);
    }
}
