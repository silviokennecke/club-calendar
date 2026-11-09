<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\Bytes;
use App\Opaque\ExpandMessageXmd;
use App\Opaque\OpaqueException;
use App\Opaque\Oprf;
use App\Opaque\Ristretto;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PrimitivesTest extends TestCase
{
    /** @return array<string, array{string, string, int, string}> */
    public static function xmdVectors(): array
    {
        $d = json_decode((string) file_get_contents(__DIR__.'/fixtures/rfc9380-xmd-sha512-vectors.json'), true, flags: JSON_THROW_ON_ERROR);
        $out = [];
        foreach ($d['vectors'] as $i => $v) {
            $out["xmd #$i len {$v['len_in_bytes']}"] = [$d['DST'], (string) hex2bin($v['msg_hex']), $v['len_in_bytes'], $v['uniform_bytes']];
        }

        return $out;
    }

    #[DataProvider('xmdVectors')]
    public function testExpandMessageXmd(string $dst, string $msg, int $len, string $expected): void
    {
        self::assertSame($expected, bin2hex(ExpandMessageXmd::expand($msg, $dst, $len)));
    }

    public function testOversizeDstIsHashed(): void
    {
        $dst = str_repeat('D', 300);
        $hashed = hash('sha512', 'H2C-OVERSIZE-DST-'.$dst, true);
        self::assertSame(ExpandMessageXmd::expand('m', $hashed, 48), ExpandMessageXmd::expand('m', $dst, 48));
        // 255 bytes is still used as is
        self::assertNotSame(ExpandMessageXmd::expand('m', str_repeat('D', 256), 48), ExpandMessageXmd::expand('m', str_repeat('D', 255), 48));
    }

    /** @return array<string, array{string, int}> */
    public static function badXmd(): array
    {
        return ['zero length' => ['dst', 0], 'ell > 255' => ['dst', 255 * 64 + 1], 'empty dst' => ['', 32], 'above 65535' => ['dst', 65536]];
    }

    #[DataProvider('badXmd')]
    public function testExpandMessageXmdRejects(string $dst, int $len): void
    {
        $this->expectException(OpaqueException::class);
        ExpandMessageXmd::expand('m', $dst, $len);
    }

    public function testMaxLengthWorks(): void
    {
        self::assertSame(255 * 64, strlen(ExpandMessageXmd::expand('m', 'dst', 255 * 64)));
    }

    public function testI2osp(): void
    {
        self::assertSame("\x01\x02", Bytes::i2osp(258, 2));
        $this->expectException(OpaqueException::class);
        Bytes::i2osp(256, 1);
    }

    /** @return array<string, array{array<string, mixed>, array<string, mixed>}> */
    public static function oprfVectors(): array
    {
        $d = json_decode((string) file_get_contents(__DIR__.'/fixtures/rfc9497-oprf-vectors.json'), true, flags: JSON_THROW_ON_ERROR);
        $out = [];
        foreach ($d['vectors'] as $v) {
            $out['vector '.$v['vector']] = [$d['header'], $v];
        }

        return $out;
    }

    public function testDeriveKeyPairFromHeader(): void
    {
        $h = json_decode((string) file_get_contents(__DIR__.'/fixtures/rfc9497-oprf-vectors.json'), true, flags: JSON_THROW_ON_ERROR)['header'];
        [$sk, $pk] = Oprf::deriveKeyPair((string) hex2bin($h['Seed']), (string) hex2bin($h['KeyInfo']));
        self::assertSame($h['skSm'], bin2hex($sk));
        self::assertSame(bin2hex(sodium_crypto_scalarmult_ristretto255_base($sk)), bin2hex($pk));
    }

    /**
     * @param array<string, mixed> $h
     * @param array<string, mixed> $v
     */
    #[DataProvider('oprfVectors')]
    public function testOprfVector(array $h, array $v): void
    {
        $input = (string) hex2bin($v['Input']);
        $blind = (string) hex2bin($v['Blind']);
        $sk = (string) hex2bin($h['skSm']);

        $blinded = OprfTestClient::blind($input, $blind);
        self::assertSame($v['BlindedElement'], bin2hex($blinded));

        $evaluated = Oprf::blindEvaluate($sk, $blinded);
        self::assertSame($v['EvaluationElement'], bin2hex($evaluated));

        self::assertSame($v['Output'], bin2hex(OprfTestClient::finalize($input, $blind, $evaluated)));
    }

    /** @return array<string, array{string}> */
    public static function badElements(): array
    {
        return [
            'identity' => [str_repeat("\0", 32)],
            'too short' => [str_repeat("\x01", 31)],
            'too long' => [str_repeat("\x01", 33)],
            'empty' => [''],
            'non-canonical (p)' => [(string) hex2bin('edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f')],
            'negative (odd) encoding' => [(string) hex2bin('0100000000000000000000000000000000000000000000000000000000000000')],
            'high bit set' => [(string) hex2bin('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
        ];
    }

    #[DataProvider('badElements')]
    public function testBlindEvaluateRejectsBadElements(string $element): void
    {
        $this->expectException(OpaqueException::class);
        Oprf::blindEvaluate(str_repeat("\x05", 32), $element);
    }

    /** @return array<string, array{string}> */
    public static function badScalars(): array
    {
        return [
            'zero' => [str_repeat("\0", 32)],
            'short' => [str_repeat("\x01", 31)],
            'order l' => [(string) hex2bin('edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010')],
            'all ff' => [str_repeat("\xff", 32)],
        ];
    }

    #[DataProvider('badScalars')]
    public function testRejectsBadScalars(string $scalar): void
    {
        $point = Oprf::hashToGroup('x');
        $this->expectException(OpaqueException::class);
        Oprf::blindEvaluate($scalar, $point);
    }

    public function testDeriveKeyPairRejectsBadSeed(): void
    {
        $this->expectException(OpaqueException::class);
        Oprf::deriveKeyPair(str_repeat('a', 31), 'info');
    }

    public function testHashToGroupIsValidAndDeterministic(): void
    {
        $p = Oprf::hashToGroup('abc');
        Ristretto::assertElement($p);
        self::assertSame($p, Oprf::hashToGroup('abc'));
        self::assertNotSame($p, Oprf::hashToGroup('abd'));
    }
}
