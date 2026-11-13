<?php

declare(strict_types=1);

namespace App\Messenger;

use App\Security\Secret\SecretCipher;
use App\Security\Secret\SecretCipherException;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\Exception\MessageDecodingFailedException;
use Symfony\Component\Messenger\Transport\Serialization\SerializerInterface;

/**
 * Encrypts the body of queued messages (they may carry mail addresses, links and codes) with the application's
 * SecretCipher; headers (incl. `type`) stay readable for routing and diagnosis. A body that does not decrypt is
 * a decoding failure, so the message goes to failure handling instead of crashing the worker.
 */
final class EncryptingSerializer implements SerializerInterface
{
    public function __construct(
        private readonly SerializerInterface $inner,
        private readonly SecretCipher $cipher,
    ) {
    }

    public function decode(array $encodedEnvelope): Envelope
    {
        $body = $encodedEnvelope['body'] ?? null;
        if (!is_string($body)) {
            throw new MessageDecodingFailedException('Encrypted message body is missing.');
        }
        if (!str_starts_with($body, 'enc:')) {
            throw new MessageDecodingFailedException('Message body is not encrypted.');
        }
        try {
            $plain = $this->cipher->decrypt($body, SecretCipher::PURPOSE_MESSENGER);
        } catch (SecretCipherException) {
            throw new MessageDecodingFailedException('Message body could not be decrypted.');
        }
        $encodedEnvelope['body'] = $plain;

        return $this->inner->decode($encodedEnvelope);
    }

    public function encode(Envelope $envelope): array
    {
        $encoded = $this->inner->encode($envelope);
        $encoded['body'] = $this->cipher->encrypt($encoded['body'], SecretCipher::PURPOSE_MESSENGER);

        return $encoded;
    }
}
