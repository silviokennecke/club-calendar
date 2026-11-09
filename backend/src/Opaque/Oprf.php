<?php

declare(strict_types=1);

namespace App\Opaque;

/** OPRF(ristretto255, SHA-512), base mode 0x00, server side (RFC 9497). */
final class Oprf
{
    public const int MODE_OPRF = 0;
    private const string SUITE = 'ristretto255-SHA512';

    public static function contextString(int $mode = self::MODE_OPRF): string
    {
        return 'OPRFV1-'.Bytes::i2osp($mode, 1).'-'.self::SUITE;
    }

    public static function hashToGroup(string $input, ?string $dst = null): string
    {
        $dst ??= 'HashToGroup-'.self::contextString();

        return Ristretto::fromHash(ExpandMessageXmd::expand($input, $dst, 64));
    }

    public static function hashToScalar(string $input, ?string $dst = null): string
    {
        $dst ??= 'HashToScalar-'.self::contextString();

        // 64 uniform bytes, read little-endian (ristretto255 scalar encoding), reduced by libsodium
        return Ristretto::reduce(ExpandMessageXmd::expand($input, $dst, 64));
    }

    /**
     * RFC 9497 §3.2.1 DeriveKeyPair.
     *
     * @return array{0: string, 1: string} [private scalar, public element]
     */
    public static function deriveKeyPair(#[\SensitiveParameter] string $seed, string $info): array
    {
        if (32 !== strlen($seed) || strlen($info) > 65535) {
            throw new OpaqueException('DeriveKeyPair: invalid seed or info length.');
        }
        $deriveInput = $seed.Bytes::i2osp(strlen($info), 2).$info;
        $dst = 'DeriveKeyPair'.self::contextString();
        for ($counter = 0; $counter < 256; ++$counter) {
            $sk = self::hashToScalar($deriveInput.Bytes::i2osp($counter, 1), $dst);
            if (!hash_equals(str_repeat("\0", 32), $sk)) {
                $pk = sodium_crypto_scalarmult_ristretto255_base($sk);
                sodium_memzero($deriveInput);

                return [$sk, $pk];
            }
        }

        throw new OpaqueException('DeriveKeyPair failed.');
    }

    /** BlindEvaluate (§3.3.1): validates the blinded element, returns sk * blinded. */
    public static function blindEvaluate(#[\SensitiveParameter] string $privateKey, string $blindedElement): string
    {
        return Ristretto::mult($privateKey, $blindedElement);
    }
}
