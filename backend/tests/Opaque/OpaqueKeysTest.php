<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\OpaqueException;
use App\Opaque\OpaqueKeys;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class OpaqueKeysTest extends TestCase
{
    public function testValidKeysDerivePublicKey(): void
    {
        $seed = random_bytes(64);
        $private = sodium_crypto_core_ristretto255_scalar_random();

        $keys = new OpaqueKeys(OpaqueKeys::encode($seed), OpaqueKeys::encode($private));

        self::assertSame($seed, $keys->oprfSeed());
        self::assertSame($private, $keys->serverPrivateKey());
        self::assertSame(sodium_crypto_scalarmult_ristretto255_base($private), $keys->serverPublicKey());
        self::assertSame(32, strlen($keys->serverPublicKey()));
    }

    public function testMissingKeysFailEarly(): void
    {
        $this->expectException(OpaqueException::class);
        new OpaqueKeys('', '');
    }

    public function testDoesNotLeakSecrets(): void
    {
        $private = sodium_crypto_core_ristretto255_scalar_random();
        $keys = new OpaqueKeys(OpaqueKeys::encode(random_bytes(64)), OpaqueKeys::encode($private));

        ob_start();
        var_dump($keys);
        $dump = (string) ob_get_clean();

        self::assertStringNotContainsString(OpaqueKeys::encode($private), $dump);
        self::assertStringNotContainsString(bin2hex($private), $dump);
        $this->expectException(\LogicException::class);
        serialize($keys);
    }

    /** @return iterable<string, array{string, string, string}> */
    public static function invalidProvider(): iterable
    {
        $seed = OpaqueKeys::encode(random_bytes(64));
        $key = OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random());

        yield 'missing seed' => ['', $key, 'OPAQUE_OPRF_SEED'];
        yield 'missing key' => [$seed, '', 'OPAQUE_SERVER_PRIVATE_KEY'];
        yield 'short seed' => [OpaqueKeys::encode(random_bytes(32)), $key, 'OPAQUE_OPRF_SEED'];
        yield 'long key' => [$seed, OpaqueKeys::encode(random_bytes(33)), 'OPAQUE_SERVER_PRIVATE_KEY'];
        yield 'padded base64' => [$seed.'==', $key, 'OPAQUE_OPRF_SEED'];
        yield 'standard alphabet' => [strtr($seed, '-_', '+/').'+', $key, 'OPAQUE_OPRF_SEED'];
        yield 'not base64' => ['!!!', $key, 'OPAQUE_OPRF_SEED'];
        yield 'non-canonical scalar' => [$seed, OpaqueKeys::encode(str_repeat("\xff", 32)), 'canonical'];
        yield 'zero scalar' => [$seed, OpaqueKeys::encode(str_repeat("\0", 32)), 'canonical'];
    }

    #[DataProvider('invalidProvider')]
    public function testInvalidValuesFailEarly(string $seed, string $key, string $needle): void
    {
        $this->expectException(OpaqueException::class);
        $this->expectExceptionMessageMatches('/'.preg_quote($needle, '/').'/');

        new OpaqueKeys($seed, $key);
    }

    public function testErrorMessageNeverContainsTheValue(): void
    {
        $bad = OpaqueKeys::encode(random_bytes(31));
        try {
            new OpaqueKeys($bad, $bad);
            self::fail('expected exception');
        } catch (OpaqueException $e) {
            self::assertStringNotContainsString($bad, $e->getMessage());
        }
    }

    public function testConfiguredTestKeysAreValid(): void
    {
        $keys = new OpaqueKeys(
            (string) getenv('OPAQUE_OPRF_SEED'),
            (string) getenv('OPAQUE_SERVER_PRIVATE_KEY'),
        );

        self::assertSame(64, strlen($keys->oprfSeed()));
    }

    private static function sets(string ...$ids): string
    {
        return implode(',', array_map(static fn (string $id): string => $id.':'.OpaqueKeys::encode(random_bytes(64)).':'.OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()), $ids));
    }

    public function testLegacyPairIsKeyOneAndActiveByDefault(): void
    {
        $keys = new OpaqueKeys(OpaqueKeys::encode(random_bytes(64)), OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()));

        self::assertSame('1', $keys->activeId());
        self::assertSame(['1'], $keys->ids());
        self::assertTrue($keys->has('1'));
        self::assertFalse($keys->has('2'));
    }

    public function testMultipleSetsWithLegacyPairAndExplicitActiveId(): void
    {
        $seed = random_bytes(64);
        $private = sodium_crypto_core_ristretto255_scalar_random();
        $keys = new OpaqueKeys(OpaqueKeys::encode($seed), OpaqueKeys::encode($private), self::sets('2', 'k-3'), '2');

        self::assertSame(['1', '2', 'k-3'], $keys->ids());
        self::assertSame('2', $keys->activeId());
        self::assertSame($seed, $keys->oprfSeed('1'));
        self::assertNotSame($keys->oprfSeed('1'), $keys->oprfSeed());
        self::assertSame(sodium_crypto_scalarmult_ristretto255_base($keys->serverPrivateKey('k-3')), $keys->serverPublicKey('k-3'));
    }

    public function testKeySetsAloneWithoutLegacyPair(): void
    {
        $keys = new OpaqueKeys('', '', self::sets('a', 'b'), 'b');

        self::assertSame(['a', 'b'], $keys->ids());
        self::assertSame('b', $keys->activeId());
    }

    /** @return iterable<string, array{string, string, string, bool}> sets, active id, expected message part, legacy pair present */
    public static function invalidSetsProvider(): iterable
    {
        $one = self::sets('2');
        $enc = static fn (string $b): string => OpaqueKeys::encode($b);
        yield 'duplicate id' => [$one.','.$one, '2', 'defined twice', false];
        yield 'id 1 twice (legacy pair present)' => [self::sets('1'), '1', 'defined twice', true];
        yield 'active id missing' => [$one, '9', 'OPAQUE_ACTIVE_KEY_ID', false];
        yield 'default active 1 missing' => [$one, '', 'OPAQUE_ACTIVE_KEY_ID', false];
        yield 'malformed entry' => ['2:onlyseed', '2', 'id:seed:privateKey', false];
        yield 'bad id' => [str_replace('2:', 'a b:', $one), 'a b', 'id:seed:privateKey', false];
        yield 'bad seed' => ['2:'.$enc(random_bytes(10)).':'.$enc(sodium_crypto_core_ristretto255_scalar_random()), '2', 'OPAQUE_KEYS[2] seed', false];
        yield 'bad scalar' => ['2:'.$enc(random_bytes(64)).':'.$enc(str_repeat("\xff", 32)), '2', 'canonical', false];
    }

    #[DataProvider('invalidSetsProvider')]
    public function testInvalidKeySetsFailEarly(string $sets, string $active, string $needle, bool $legacy): void
    {
        $this->expectException(OpaqueException::class);
        $this->expectExceptionMessageMatches('/'.preg_quote($needle, '/').'/');

        new OpaqueKeys(
            $legacy ? OpaqueKeys::encode(random_bytes(64)) : '',
            $legacy ? OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()) : '',
            $sets,
            $active,
        );
    }

    public function testUnknownIdAccessThrows(): void
    {
        $keys = new OpaqueKeys('', '', self::sets('a'), 'a');
        $this->expectException(OpaqueException::class);
        $keys->oprfSeed('zz');
    }
}
