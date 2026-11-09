<?php

declare(strict_types=1);

namespace App\Opaque;

/** Internal byte helpers (RFC 8017 §4.1 I2OSP, RFC 9380 §5.3 strxor). */
final class Bytes
{
    public static function i2osp(int $value, int $length): string
    {
        if ($length < 1 || $value < 0 || ($length < 8 && $value >= 1 << (8 * $length))) {
            throw new OpaqueException('I2OSP value out of range.');
        }

        return substr(pack('J', $value), 8 - $length);
    }

    public static function xor(string $a, string $b): string
    {
        if (strlen($a) !== strlen($b)) {
            throw new OpaqueException('XOR operands differ in length.');
        }

        return $a ^ $b;
    }
}
