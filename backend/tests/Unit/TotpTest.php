<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\Mfa\Totp;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class TotpTest extends TestCase
{
    private const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"

    /** @return iterable<string, array{int, string}> RFC 6238 appendix B (SHA-1), last 6 digits */
    public static function vectors(): iterable
    {
        yield 'T=59' => [59, '287082'];
        yield 'T=1111111109' => [1111111109, '081804'];
        yield 'T=1111111111' => [1111111111, '050471'];
        yield 'T=1234567890' => [1234567890, '005924'];
        yield 'T=2000000000' => [2000000000, '279037'];
        yield 'T=20000000000' => [20000000000, '353130'];
    }

    #[DataProvider('vectors')]
    public function testRfcVectors(int $time, string $expected): void
    {
        $this->assertSame($expected, Totp::code(self::SECRET, Totp::step($time)));
        $this->assertSame(Totp::step($time), Totp::verify(self::SECRET, $expected, null, $time));
    }

    public function testWindowAllowsOneStepDrift(): void
    {
        $t = 1111111109;
        $step = Totp::step($t);
        $this->assertSame($step - 1, Totp::verify(self::SECRET, Totp::code(self::SECRET, $step - 1), null, $t));
        $this->assertSame($step + 1, Totp::verify(self::SECRET, Totp::code(self::SECRET, $step + 1), null, $t));
        $this->assertNull(Totp::verify(self::SECRET, Totp::code(self::SECRET, $step + 2), null, $t));
        $this->assertNull(Totp::verify(self::SECRET, Totp::code(self::SECRET, $step - 2), null, $t));
    }

    public function testReplayOfUsedStepRejected(): void
    {
        $t = 1111111109;
        $step = Totp::step($t);
        $code = Totp::code(self::SECRET, $step);
        $this->assertNull(Totp::verify(self::SECRET, $code, $step, $t));
        $this->assertNull(Totp::verify(self::SECRET, Totp::code(self::SECRET, $step - 1), $step, $t));
        $this->assertSame($step + 1, Totp::verify(self::SECRET, Totp::code(self::SECRET, $step + 1), $step, $t));
    }

    public function testMalformedCodesRejected(): void
    {
        $t = 59;
        foreach (['', '12345', '1234567', 'abcdef', '28708a'] as $bad) {
            $this->assertNull(Totp::verify(self::SECRET, $bad, null, $t));
        }
        $this->assertSame(Totp::step($t), Totp::verify(self::SECRET, '287 082', null, $t));
    }

    public function testBase32RoundTripAndRfcVectors(): void
    {
        $this->assertSame('MZXW6YQ', Totp::base32Encode('foob'));
        $this->assertSame('MZXW6YTBOI', Totp::base32Encode('foobar'));
        $this->assertSame('foobar', Totp::base32Decode('MZXW6YTBOI======'));
        $this->assertSame('12345678901234567890', Totp::base32Decode(self::SECRET));
        $data = random_bytes(20);
        $this->assertSame($data, Totp::base32Decode(Totp::base32Encode($data)));
        $this->expectException(\InvalidArgumentException::class);
        Totp::base32Decode('AB1');
    }

    public function testGeneratedSecret(): void
    {
        $s = Totp::generateSecret();
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $s);
        $this->assertNotSame($s, Totp::generateSecret());
    }

    public function testOtpauthUri(): void
    {
        $uri = Totp::otpauthUri('Club Calendar', 'a+b@example.com', self::SECRET);
        $this->assertSame(
            'otpauth://totp/Club%20Calendar:a%2Bb%40example.com?secret='.self::SECRET.'&issuer=Club%20Calendar&algorithm=SHA1&digits=6&period=30',
            $uri,
        );
    }
}
