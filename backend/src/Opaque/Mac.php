<?php

declare(strict_types=1);

namespace App\Opaque;

/** HMAC-SHA-512. */
final class Mac
{
    public const int LENGTH = 64;

    public static function compute(#[\SensitiveParameter] string $key, string $message): string
    {
        return hash_hmac('sha512', $message, $key, true);
    }

    /** Constant-time. */
    public static function verify(#[\SensitiveParameter] string $key, string $message, string $tag): bool
    {
        return self::LENGTH === strlen($tag) && hash_equals(self::compute($key, $message), $tag);
    }
}
