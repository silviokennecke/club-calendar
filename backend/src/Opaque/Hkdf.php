<?php

declare(strict_types=1);

namespace App\Opaque;

/** HKDF-SHA-512 (RFC 5869) and the OPAQUE Expand-Label / Derive-Secret helpers (RFC 9807 §6.4.2.2). */
final class Hkdf
{
    public const int HASH_LENGTH = 64;

    public static function extract(string $salt, #[\SensitiveParameter] string $ikm): string
    {
        return hash_hmac('sha512', $ikm, $salt, true);
    }

    public static function expand(#[\SensitiveParameter] string $prk, string $info, int $length): string
    {
        if (self::HASH_LENGTH !== strlen($prk) || $length < 1 || $length > 255 * self::HASH_LENGTH) {
            throw new OpaqueException('HKDF-Expand: invalid PRK or output length.');
        }
        $okm = '';
        $t = '';
        for ($i = 1; strlen($okm) < $length; ++$i) {
            $t = hash_hmac('sha512', $t.$info.chr($i), $prk, true);
            $okm .= $t;
        }

        return substr($okm, 0, $length);
    }

    public static function expandLabel(#[\SensitiveParameter] string $secret, string $label, string $context, int $length): string
    {
        $fullLabel = 'OPAQUE-'.$label;
        $info = Bytes::i2osp($length, 2).Bytes::i2osp(strlen($fullLabel), 1).$fullLabel.Bytes::i2osp(strlen($context), 1).$context;

        return self::expand($secret, $info, $length);
    }

    public static function deriveSecret(#[\SensitiveParameter] string $secret, string $label, string $transcriptHash): string
    {
        return self::expandLabel($secret, $label, $transcriptHash, self::HASH_LENGTH);
    }
}
