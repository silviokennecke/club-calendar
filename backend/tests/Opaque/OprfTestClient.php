<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\Bytes;
use App\Opaque\Oprf;

/** Test-only OPRF client (RFC 9497 §3.3.1 Blind / Finalize), needed to run the vectors end to end. */
final class OprfTestClient
{
    public static function blind(string $input, string $blind): string
    {
        return sodium_crypto_scalarmult_ristretto255($blind, Oprf::hashToGroup($input));
    }

    public static function finalize(string $input, string $blind, string $evaluated): string
    {
        $unblinded = sodium_crypto_scalarmult_ristretto255(sodium_crypto_core_ristretto255_scalar_invert($blind), $evaluated);

        return hash('sha512', Bytes::i2osp(strlen($input), 2).$input.Bytes::i2osp(strlen($unblinded), 2).$unblinded.'Finalize', true);
    }
}
