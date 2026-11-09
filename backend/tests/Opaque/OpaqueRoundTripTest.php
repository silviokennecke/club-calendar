<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\AuthenticationFailedException;
use App\Opaque\InvalidMessageException;
use App\Opaque\OpaqueException;
use App\Opaque\OpaqueServer;
use App\Opaque\RegistrationRecord;
use App\Opaque\ServerLoginState;
use PHPUnit\Framework\TestCase;

final class OpaqueRoundTripTest extends TestCase
{
    private const string CRED = '0192f6c0-0000-7000-8000-000000000001';

    private OpaqueServer $server;

    protected function setUp(): void
    {
        $this->server = new OpaqueServer(sodium_crypto_core_ristretto255_scalar_random(), random_bytes(64));
    }

    private function register(OpaqueTestClient $client, string $password): RegistrationRecord
    {
        $start = $client->startRegistration($password);
        $response = $this->server->createRegistrationResponse($start['request'], self::CRED);
        self::assertSame(64, strlen($response));
        $done = $client->finishRegistration($password, $start['blind'], $response);
        self::assertSame($this->server->serverPublicKey(), $done['serverPublicKey']);

        return RegistrationRecord::fromBytes($done['record']);
    }

    public function testLoginSucceedsAndSessionKeysMatch(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'correct horse');
        $login = $client->startLogin('correct horse');
        $start = $this->server->generateKE2($login['ke1'], $record, self::CRED);
        self::assertSame(320, strlen($start->ke2));
        $result = $client->finishLogin('correct horse', $login, $start->ke2, $this->server->serverPublicKey());
        self::assertNotNull($result);
        self::assertSame($result['sessionKey'], $this->server->serverFinish($start->state, $result['ke3']));
        self::assertSame(64, strlen($result['sessionKey']));
    }

    public function testExportKeyIsStableAcrossLogins(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'pw-123456');
        $keys = [];
        for ($i = 0; $i < 2; ++$i) {
            $login = $client->startLogin('pw-123456');
            $start = $this->server->generateKE2($login['ke1'], $record, self::CRED);
            $keys[] = $client->finishLogin('pw-123456', $login, $start->ke2)['exportKey'];
        }
        self::assertSame($keys[0], $keys[1]);
    }

    public function testCustomIdentitiesAndContext(): void
    {
        $server = new OpaqueServer(sodium_crypto_core_ristretto255_scalar_random(), random_bytes(64), 'ctx', 'calendar.example.org');
        $client = new OpaqueTestClient('ctx', 'alice', 'calendar.example.org');
        $start = $client->startRegistration('pw');
        $record = RegistrationRecord::fromBytes($client->finishRegistration('pw', $start['blind'], $server->createRegistrationResponse($start['request'], self::CRED))['record']);
        $login = $client->startLogin('pw');
        $ke = $server->generateKE2($login['ke1'], $record, self::CRED, 'alice');
        $res = $client->finishLogin('pw', $login, $ke->ke2);
        self::assertNotNull($res);
        self::assertSame($res['sessionKey'], $server->serverFinish($ke->state, $res['ke3']));

        // mismatching context or client identity breaks the MAC
        foreach ([[new OpaqueTestClient('other', 'alice', 'calendar.example.org'), 'alice'], [$client, 'mallory']] as [$c, $id]) {
            $l = $c->startLogin('pw');
            $k = $server->generateKE2($l['ke1'], $record, self::CRED, $id);
            self::assertNull($c->finishLogin('pw', $l, $k->ke2));
        }
    }

    public function testWrongPasswordFailsOnClient(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'right');
        $login = $client->startLogin('wrong');
        $start = $this->server->generateKE2($login['ke1'], $record, self::CRED);
        self::assertNull($client->finishLogin('wrong', $login, $start->ke2));
    }

    public function testTamperedKe3IsRejected(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'pw');
        $login = $client->startLogin('pw');
        $start = $this->server->generateKE2($login['ke1'], $record, self::CRED);
        $ke3 = $client->finishLogin('pw', $login, $start->ke2)['ke3'];
        $ke3[10] = $ke3[10] ^ "\x01";
        $this->expectException(AuthenticationFailedException::class);
        $this->server->serverFinish($start->state, $ke3);
    }

    public function testWrongKe3LengthIsRejected(): void
    {
        $state = new ServerLoginState(str_repeat('a', 64), str_repeat('b', 64));
        $this->expectException(InvalidMessageException::class);
        $this->server->serverFinish($state, str_repeat('b', 63));
    }

    public function testTamperedKe2FailsOnClient(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'pw');
        $login = $client->startLogin('pw');
        $start = $this->server->generateKE2($login['ke1'], $record, self::CRED);
        // masked response, server nonce, server keyshare (stay a valid element or not), MAC
        foreach ([70, 100, 200, 300] as $pos) {
            $ke2 = $start->ke2;
            $ke2[$pos] = $ke2[$pos] ^ "\x01";
            self::assertNull($client->finishLogin('pw', $login, $ke2), "byte $pos");
        }
    }

    public function testWrongServerKeyIsDetectedByPinningClient(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'pw');
        $other = new OpaqueServer(sodium_crypto_core_ristretto255_scalar_random(), random_bytes(64));
        $login = $client->startLogin('pw');
        $start = $this->server->generateKE2($login['ke1'], $record, self::CRED);
        self::assertNull($client->finishLogin('pw', $login, $start->ke2, $other->serverPublicKey()));
    }

    public function testFakePathLooksLikeARealAnswerAndNeverAuthenticates(): void
    {
        $client = new OpaqueTestClient();
        $login = $client->startLogin('whatever');
        $a = $this->server->generateFakeKE2($login['ke1'], 'fake:nobody@example.org');
        $b = $this->server->generateFakeKE2($login['ke1'], 'fake:nobody@example.org');
        self::assertSame(320, strlen($a->ke2));
        // stable OPRF output per address, everything else fresh
        self::assertSame(substr($a->ke2, 0, 32), substr($b->ke2, 0, 32));
        self::assertNotSame(substr($a->ke2, 32, 32), substr($b->ke2, 32, 32));
        self::assertNull($client->finishLogin('whatever', $login, $a->ke2));
        // another address gets another OPRF output
        $c = $this->server->generateFakeKE2($login['ke1'], 'fake:other@example.org');
        self::assertNotSame(substr($a->ke2, 0, 32), substr($c->ke2, 0, 32));
        // a forged KE3 cannot pass
        $this->expectException(AuthenticationFailedException::class);
        $this->server->serverFinish($a->state, random_bytes(64));
    }

    public function testFakeOprfOutputMatchesRealAccountBehaviour(): void
    {
        // same credential id => same evaluated element for fake and real records (no oracle through the OPRF)
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'pw');
        $login = $client->startLogin('pw');
        $real = $this->server->generateKE2($login['ke1'], $record, self::CRED);
        $fake = $this->server->generateFakeKE2($login['ke1'], self::CRED);
        self::assertSame(substr($real->ke2, 0, 32), substr($fake->ke2, 0, 32));
    }

    public function testInvalidElementsAndLengthsAreRejected(): void
    {
        $client = new OpaqueTestClient();
        $record = $this->register($client, 'pw');
        $login = $client->startLogin('pw');
        $zero = str_repeat("\0", 32);
        $junk = str_repeat("\xff", 32);

        foreach ([
            $zero.substr($login['ke1'], 32),
            $junk.substr($login['ke1'], 32),
            substr($login['ke1'], 0, 64).$zero,
            substr($login['ke1'], 0, 64).$junk,
            substr($login['ke1'], 0, 95),
            $login['ke1'].'x',
            '',
        ] as $bad) {
            try {
                $this->server->generateKE2($bad, $record, self::CRED);
                self::fail('Accepted invalid KE1');
            } catch (InvalidMessageException) {
                $this->addToAssertionCount(1);
            }
        }

        foreach ([$zero, $junk, 'short', ''] as $bad) {
            try {
                $this->server->createRegistrationResponse($bad, self::CRED);
                self::fail('Accepted invalid registration request');
            } catch (InvalidMessageException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testRecordParsingRejectsBadInput(): void
    {
        $client = new OpaqueTestClient();
        $bytes = $this->register($client, 'pw')->toBytes();
        foreach ([substr($bytes, 0, 191), $bytes.'x', '', str_repeat("\0", 32).substr($bytes, 32), str_repeat("\xff", 32).substr($bytes, 32)] as $bad) {
            try {
                RegistrationRecord::fromBytes($bad);
                self::fail('Accepted invalid record');
            } catch (\App\Opaque\CorruptRecordException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testConfigurationIsValidated(): void
    {
        foreach ([
            fn () => new OpaqueServer(sodium_crypto_core_ristretto255_scalar_random(), random_bytes(32)),
            fn () => new OpaqueServer(str_repeat("\xff", 32), random_bytes(64)),
            fn () => new OpaqueServer(str_repeat("\0", 32), random_bytes(64)),
            fn () => OpaqueServer::deriveOprfKey(random_bytes(64), ''),
        ] as $make) {
            try {
                $make();
                self::fail('Accepted invalid configuration');
            } catch (OpaqueException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testStateCannotBeSerialized(): void
    {
        $this->expectException(\LogicException::class);
        serialize(new ServerLoginState(str_repeat('a', 64), str_repeat('b', 64)));
    }
}
