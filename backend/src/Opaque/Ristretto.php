<?php

declare(strict_types=1);

namespace App\Opaque;

/** Thin ristretto255 wrapper over ext-sodium; every input point is validated and the identity is rejected. */
final class Ristretto
{
    public const int ELEMENT_LENGTH = 32;
    public const int SCALAR_LENGTH = 32;

    public static function assertElement(string $point): void
    {
        if (self::ELEMENT_LENGTH !== strlen($point)
            || !sodium_crypto_core_ristretto255_is_valid_point($point)
            || hash_equals(str_repeat("\0", self::ELEMENT_LENGTH), $point)) {
            throw new OpaqueException('Invalid ristretto255 element.');
        }
    }

    /** Canonical (< group order) and non-zero. */
    public static function assertScalar(#[\SensitiveParameter] string $scalar): void
    {
        if (self::SCALAR_LENGTH !== strlen($scalar)) {
            throw new OpaqueException('Invalid scalar length.');
        }
        $reduced = substr(sodium_crypto_core_ristretto255_scalar_reduce($scalar.str_repeat("\0", 32)), 0, 32);
        $canonical = hash_equals($reduced, $scalar);
        $nonZero = !hash_equals(str_repeat("\0", 32), $scalar);
        if (!$canonical || !$nonZero) {
            throw new OpaqueException('Invalid ristretto255 scalar.');
        }
    }

    public static function fromHash(string $hash64): string
    {
        return sodium_crypto_core_ristretto255_from_hash($hash64);
    }

    /** Reduces 64 little-endian bytes mod the group order. */
    public static function reduce(#[\SensitiveParameter] string $bytes64): string
    {
        return sodium_crypto_core_ristretto255_scalar_reduce($bytes64);
    }

    public static function baseMult(#[\SensitiveParameter] string $scalar): string
    {
        self::assertScalar($scalar);

        return sodium_crypto_scalarmult_ristretto255_base($scalar);
    }

    public static function mult(#[\SensitiveParameter] string $scalar, string $point): string
    {
        self::assertScalar($scalar);
        self::assertElement($point);
        try {
            $result = sodium_crypto_scalarmult_ristretto255($scalar, $point);
        } catch (\SodiumException $e) {
            throw new OpaqueException('ristretto255 scalar multiplication failed.', 0, $e);
        }
        self::assertElement($result);

        return $result;
    }
}
