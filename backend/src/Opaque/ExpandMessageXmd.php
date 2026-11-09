<?php

declare(strict_types=1);

namespace App\Opaque;

/** expand_message_xmd with SHA-512 (RFC 9380 §5.3.1). */
final class ExpandMessageXmd
{
    private const int B_IN_BYTES = 64;
    private const int S_IN_BYTES = 128;
    private const int MAX_DST = 255;

    public static function expand(string $msg, string $dst, int $lenInBytes): string
    {
        $ell = intdiv($lenInBytes + self::B_IN_BYTES - 1, self::B_IN_BYTES);
        if ($lenInBytes < 1 || $ell > 255 || $lenInBytes > 65535) {
            throw new OpaqueException('expand_message_xmd: invalid len_in_bytes.');
        }
        if ('' === $dst) {
            throw new OpaqueException('expand_message_xmd: empty DST.');
        }
        if (strlen($dst) > self::MAX_DST) {
            // §5.3.3: oversize DST is replaced by H("H2C-OVERSIZE-DST-" || DST)
            $dst = hash('sha512', 'H2C-OVERSIZE-DST-'.$dst, true);
        }
        $dstPrime = $dst.Bytes::i2osp(strlen($dst), 1);
        $b0 = hash('sha512', str_repeat("\0", self::S_IN_BYTES).$msg.Bytes::i2osp($lenInBytes, 2)."\0".$dstPrime, true);
        $bi = hash('sha512', $b0."\x01".$dstPrime, true);
        $uniform = $bi;
        for ($i = 2; $i <= $ell; ++$i) {
            $bi = hash('sha512', Bytes::xor($b0, $bi).Bytes::i2osp($i, 1).$dstPrime, true);
            $uniform .= $bi;
        }

        return substr($uniform, 0, $lenInBytes);
    }
}
