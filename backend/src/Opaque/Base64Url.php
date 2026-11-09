<?php

declare(strict_types=1);

namespace App\Opaque;

/** Strict unpadded base64url for the wire format of the OPAQUE endpoints. */
final class Base64Url
{
    public static function encode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** @return string|null null for anything but canonical unpadded base64url */
    public static function decode(string $value): ?string
    {
        if ('' === $value || 1 !== preg_match('/^[A-Za-z0-9_-]+$/', $value) || 1 === strlen($value) % 4) {
            return null;
        }
        $raw = base64_decode(strtr($value, '-_', '+/'), true);

        return false !== $raw && self::encode($raw) === $value ? $raw : null;
    }
}
