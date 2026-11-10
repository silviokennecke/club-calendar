<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\Secret\SecretCipher;
use App\Security\Secret\SecretCipherException;
use PHPUnit\Framework\TestCase;

class SecretCipherTest extends TestCase
{
    public function testRoundTripFormatAndRandomNonce(): void
    {
        $c = new SecretCipher('app-secret-one');
        $a = $c->encrypt('s3cret', SecretCipher::PURPOSE_FEED);
        $b = $c->encrypt('s3cret', SecretCipher::PURPOSE_FEED);

        $this->assertMatchesRegularExpression('/^enc:v1:[0-9a-f]{8}:[A-Za-z0-9_-]+$/', $a);
        $this->assertNotSame($a, $b);
        $this->assertStringNotContainsString('s3cret', $a);
        $this->assertSame('s3cret', $c->decrypt($a, SecretCipher::PURPOSE_FEED));
        $this->assertSame('', $c->decrypt($c->encrypt('', SecretCipher::PURPOSE_FEED), SecretCipher::PURPOSE_FEED));
    }

    public function testPurposeIsBoundToTheCiphertext(): void
    {
        $c = new SecretCipher('app-secret-one');
        $this->expectException(SecretCipherException::class);
        $c->decrypt($c->encrypt('x', SecretCipher::PURPOSE_FEED), SecretCipher::PURPOSE_SUBSCRIPTION);
    }

    public function testTamperingIsDetected(): void
    {
        $c = new SecretCipher('app-secret-one');
        $value = $c->encrypt('abcdef', SecretCipher::PURPOSE_FEED);
        $i = strlen($value) - 10;
        $tampered = substr($value, 0, $i).('A' === $value[$i] ? 'B' : 'A').substr($value, $i + 1);

        $this->expectException(SecretCipherException::class);
        $c->decrypt($tampered, SecretCipher::PURPOSE_FEED);
    }

    public function testMalformedValuesFailClearly(): void
    {
        $c = new SecretCipher('app-secret-one');
        foreach (['enc:v2:abcd1234:AAAA', 'enc:v1:abcd1234', 'enc:v1:'.substr($c->encrypt('x', 'p'), 7, 8).':AAAA'] as $bad) {
            try {
                $c->decrypt($bad, 'p');
                $this->fail("accepted $bad");
            } catch (SecretCipherException $e) {
                $this->assertStringNotContainsString('AAAA', $e->getMessage());
            }
        }
    }

    public function testKeyRingDecryptsOldKeysAndUnknownKeyIdIsAnError(): void
    {
        $old = new SecretCipher('old-secret');
        $stored = $old->encrypt('value', SecretCipher::PURPOSE_SUBSCRIPTION);

        $ring = new SecretCipher('new-secret', 'older, old-secret ,');
        $this->assertSame('value', $ring->decrypt($stored, SecretCipher::PURPOSE_SUBSCRIPTION));
        $this->assertFalse($ring->usesCurrentKey($stored));
        $this->assertTrue($ring->usesCurrentKey($ring->encrypt('v', SecretCipher::PURPOSE_FEED)));

        $this->expectException(SecretCipherException::class);
        $this->expectExceptionMessage('unknown key');
        (new SecretCipher('new-secret'))->decrypt($stored, SecretCipher::PURPOSE_SUBSCRIPTION);
    }

    public function testLegacyPlaintextIsReadAsIs(): void
    {
        $c = new SecretCipher('app-secret-one');
        $this->assertSame('0123abcd', $c->decrypt('0123abcd', SecretCipher::PURPOSE_FEED));
        $this->assertFalse($c->usesCurrentKey('0123abcd'));
        $this->assertFalse(SecretCipher::isEncrypted('0123abcd'));
    }

    public function testKeyIsNotTheRawAppSecretAndDiffersPerSecret(): void
    {
        $a = (new SecretCipher('one'))->encrypt('x', 'p');
        $b = (new SecretCipher('two'))->encrypt('x', 'p');
        $this->assertNotSame(explode(':', $a)[2], explode(':', $b)[2]);
    }
}
