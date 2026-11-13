<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Messenger\EncryptingSerializer;
use App\Security\Secret\SecretCipher;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\Exception\MessageDecodingFailedException;
use Symfony\Component\Messenger\Transport\Serialization\PhpSerializer;

class EncryptingSerializerTest extends TestCase
{
    private function serializer(string $secret = 'app-secret-one', string $previous = ''): EncryptingSerializer
    {
        return new EncryptingSerializer(new PhpSerializer(), new SecretCipher($secret, $previous));
    }

    private function message(): \stdClass
    {
        $m = new \stdClass();
        $m->code = 'TOP-SECRET-123456';

        return $m;
    }

    public function testRoundTripKeepsHeadersReadableAndBodyEncrypted(): void
    {
        $s = $this->serializer();
        $encoded = $s->encode(new Envelope($this->message()));

        $this->assertStringNotContainsString('TOP-SECRET-123456', $encoded['body']);
        $this->assertStringStartsWith('enc:v1:', $encoded['body']);
        $this->assertSame((new PhpSerializer())->encode(new Envelope($this->message()))['headers'], $encoded['headers']);

        $decoded = $s->decode($encoded);
        $this->assertSame('TOP-SECRET-123456', $decoded->getMessage()->code);
    }

    public function testTamperedBodyFailsDecodingWithoutLeaking(): void
    {
        $s = $this->serializer();
        $encoded = $s->encode(new Envelope($this->message()));
        $i = strlen($encoded['body']) - 10;
        $encoded['body'] = substr($encoded['body'], 0, $i).('A' === $encoded['body'][$i] ? 'B' : 'A').substr($encoded['body'], $i + 1);

        try {
            $s->decode($encoded);
            $this->fail('Expected MessageDecodingFailedException');
        } catch (MessageDecodingFailedException $e) {
            $this->assertStringNotContainsString('TOP-SECRET', $e->getMessage());
            $this->assertStringNotContainsString('app-secret-one', $e->getMessage());
        }
    }

    public function testUnknownKeyAndPlainBodiesFailDecoding(): void
    {
        $encoded = $this->serializer('other-secret')->encode(new Envelope($this->message()));
        try {
            $this->serializer()->decode($encoded);
            $this->fail('Expected MessageDecodingFailedException');
        } catch (MessageDecodingFailedException) {
        }

        $plain = (new PhpSerializer())->encode(new Envelope($this->message()));
        $this->expectException(MessageDecodingFailedException::class);
        $this->serializer()->decode($plain);
    }

    public function testMissingBodyFailsDecoding(): void
    {
        $this->expectException(MessageDecodingFailedException::class);
        $this->serializer()->decode(['headers' => []]);
    }

    public function testKeyRotationDecryptsOldMessages(): void
    {
        $encoded = $this->serializer('old-secret')->encode(new Envelope($this->message()));

        $decoded = $this->serializer('new-secret', 'old-secret')->decode($encoded);
        $this->assertSame('TOP-SECRET-123456', $decoded->getMessage()->code);
    }
}
