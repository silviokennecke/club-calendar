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

        $keys = new OpaqueKeys(true, OpaqueKeys::encode($seed), OpaqueKeys::encode($private));

        self::assertTrue($keys->isEnabled());
        self::assertSame($seed, $keys->oprfSeed());
        self::assertSame($private, $keys->serverPrivateKey());
        self::assertSame(sodium_crypto_scalarmult_ristretto255_base($private), $keys->serverPublicKey());
        self::assertSame(32, strlen($keys->serverPublicKey()));
    }

    public function testDisabledNeedsNoKeysAndRefusesAccess(): void
    {
        $keys = new OpaqueKeys(false, '', '');

        self::assertFalse($keys->isEnabled());
        $this->expectException(OpaqueException::class);
        $keys->oprfSeed();
    }

    public function testDoesNotLeakSecrets(): void
    {
        $private = sodium_crypto_core_ristretto255_scalar_random();
        $keys = new OpaqueKeys(true, OpaqueKeys::encode(random_bytes(64)), OpaqueKeys::encode($private));

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

        new OpaqueKeys(true, $seed, $key);
    }

    public function testErrorMessageNeverContainsTheValue(): void
    {
        $bad = OpaqueKeys::encode(random_bytes(31));
        try {
            new OpaqueKeys(true, $bad, $bad);
            self::fail('expected exception');
        } catch (OpaqueException $e) {
            self::assertStringNotContainsString($bad, $e->getMessage());
        }
    }

    public function testConfiguredTestKeysAreValid(): void
    {
        $keys = new OpaqueKeys(
            true,
            (string) getenv('OPAQUE_OPRF_SEED'),
            (string) getenv('OPAQUE_SERVER_PRIVATE_KEY'),
        );

        self::assertSame(64, strlen($keys->oprfSeed()));
    }
}
