<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\AuthenticationFailedException;
use App\Opaque\Bytes;
use App\Opaque\CorruptRecordException;
use App\Opaque\DerivedKeys;
use App\Opaque\Hkdf;
use App\Opaque\KeySchedule;
use App\Opaque\OpaqueException;
use App\Opaque\OpaqueServer;
use App\Opaque\Oprf;
use App\Opaque\RegistrationRecord;
use App\Opaque\Ristretto;
use App\Opaque\SystemRandom;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

class OpaqueHardeningTest extends KernelTestCase
{
    public function testSeedHolderCannotCompleteAFakeLogin(): void
    {
        $seed = random_bytes(64);
        $server = new OpaqueServer(sodium_crypto_core_ristretto255_scalar_random(), $seed);
        $info = 'OPAQUE-DeriveDiffieHellmanKeyPair';

        // the old derivation (secret from the seed) no longer matches the dummy public key
        [$dsk, $dpk] = Oprf::deriveKeyPair(Hkdf::expand($seed, 'ClubCalendar-FakeClientPublicKey', 32), $info);
        self::assertNotSame($dpk, $server->dummyClientPublicKey());
        Ristretto::assertElement($server->dummyClientPublicKey());

        [$esk, $epk] = Oprf::deriveKeyPair(random_bytes(32), $info);
        $ke1 = sodium_crypto_core_ristretto255_from_hash(random_bytes(64)).random_bytes(32).$epk;
        $start = $server->generateFakeKE2($ke1, 'fake:victim@example.org');
        $ke2 = $start->ke2;
        self::assertSame(320, strlen($ke2));
        $serverEpk = substr($ke2, 224, 32);

        foreach ([$dpk, $server->dummyClientPublicKey()] as $pk) {
            $ikm = Ristretto::mult($esk, $serverEpk).Ristretto::mult($esk, $server->serverPublicKey()).Ristretto::mult($dsk, $serverEpk);
            $preamble = KeySchedule::preamble('', $pk, $ke1, $server->serverPublicKey(), substr($ke2, 0, 192), substr($ke2, 192, 32), $serverEpk);
            $keys = KeySchedule::deriveKeys($ikm, $preamble);
            $ke3 = KeySchedule::clientMac($keys, $preamble, substr($ke2, 256, 64));
            try {
                $server->serverFinish($start->state, $ke3);
                self::fail('Fake login completed');
            } catch (AuthenticationFailedException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testFakeStatesExpectIndependentRandomMacs(): void
    {
        $server = new OpaqueServer(sodium_crypto_core_ristretto255_scalar_random(), random_bytes(64));
        $ke1 = sodium_crypto_core_ristretto255_from_hash(random_bytes(64)).random_bytes(32).sodium_crypto_core_ristretto255_from_hash(random_bytes(64));
        $a = $server->generateFakeKE2($ke1, 'fake:a@example.org');
        $b = $server->generateFakeKE2($ke1, 'fake:a@example.org');
        self::assertNotSame($a->state->expectedClientMac(), $b->state->expectedClientMac());
    }

    public function testSecretsDoNotLeakThroughDumpsOrSerialization(): void
    {
        $private = sodium_crypto_core_ristretto255_scalar_random();
        $seed = random_bytes(64);
        $server = new OpaqueServer($private, $seed);
        $masking = random_bytes(64);
        $record = RegistrationRecord::fake($server->serverPublicKey(), $masking);
        $keys = new DerivedKeys(random_bytes(64), random_bytes(64), random_bytes(64), random_bytes(64), random_bytes(64));
        $secrets = [$private, $seed, $masking, $keys->sessionKey(), $keys->serverMacKey(), $keys->clientMacKey()];

        foreach ([$server, $record, $keys] as $object) {
            try {
                serialize($object);
                self::fail('serialize() succeeded for '.$object::class);
            } catch (\LogicException) {
                $this->addToAssertionCount(1);
            }
            $dumps = [print_r($object, true), (string) json_encode($object), (string) json_encode(get_object_vars($object))];
            ob_start();
            var_dump($object);
            $dumps[] = (string) ob_get_clean();
            foreach ($dumps as $dump) {
                foreach ($secrets as $secret) {
                    self::assertStringNotContainsString($secret, $dump);
                    self::assertStringNotContainsString(bin2hex($secret), $dump);
                    self::assertStringNotContainsString(base64_encode($secret), $dump);
                }
            }
            try {
                unserialize('O:'.strlen($object::class).':"'.$object::class.'":0:{}');
                self::fail('unserialize() succeeded for '.$object::class);
            } catch (\LogicException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testStoredRecordErrorIsNotAClientInputError(): void
    {
        $this->expectException(CorruptRecordException::class);
        RegistrationRecord::fromBytes(str_repeat("\1", 192));
    }

    #[DataProvider('badI2osp')]
    public function testI2ospRejectsLengthsOutsideOneToEight(int $value, int $length): void
    {
        $this->expectException(OpaqueException::class);
        Bytes::i2osp($value, $length);
    }

    /** @return iterable<string, array{int, int}> */
    public static function badI2osp(): iterable
    {
        yield 'length 9' => [1, 9];
        yield 'length 0' => [0, 0];
        yield 'negative value' => [-1, 4];
        yield 'too large' => [256, 1];
    }

    public function testI2ospEightBytes(): void
    {
        self::assertSame("\0\0\0\0\0\0\x01\x02", Bytes::i2osp(258, 8));
    }

    public function testWiredServerUsesSystemRandom(): void
    {
        $keys = new \App\Opaque\OpaqueKeys(true, \App\Opaque\OpaqueKeys::encode(random_bytes(64)), \App\Opaque\OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()));
        $server = OpaqueServer::fromKeys($keys);
        self::assertInstanceOf(SystemRandom::class, (new \ReflectionProperty($server, 'random'))->getValue($server));

        self::bootKernel();
        self::assertFalse(static::getContainer()->has(OpaqueServer::class), 'OpaqueServer must not be a container service with injected randomness');
    }
}
