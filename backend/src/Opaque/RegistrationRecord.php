<?php

declare(strict_types=1);

namespace App\Opaque;

/** Stored record (192 B): client_public_key (32) | masking_key (64) | envelope = nonce (32) | auth_tag (64). */
final readonly class RegistrationRecord
{
    public const int LENGTH = 192;
    public const int MASKING_KEY_LENGTH = 64;
    public const int ENVELOPE_LENGTH = 96;

    public function __construct(
        public string $clientPublicKey,
        #[\SensitiveParameter] public string $maskingKey,
        public string $envelope,
    ) {
        if (self::MASKING_KEY_LENGTH !== strlen($maskingKey) || self::ENVELOPE_LENGTH !== strlen($envelope)) {
            throw new InvalidMessageException('Invalid registration record field length.');
        }
        try {
            Ristretto::assertElement($clientPublicKey);
        } catch (OpaqueException $e) {
            throw new InvalidMessageException('Registration record has an invalid client public key.', 0, $e);
        }
    }

    public static function fromBytes(#[\SensitiveParameter] string $bytes): self
    {
        if (self::LENGTH !== strlen($bytes)) {
            throw new InvalidMessageException('Registration record must be 192 bytes.');
        }

        return new self(substr($bytes, 0, 32), substr($bytes, 32, 64), substr($bytes, 96, 96));
    }

    /** RFC 9807 §6.4.2 / §10.9 fake record: all-zero envelope. */
    public static function fake(string $clientPublicKey, #[\SensitiveParameter] string $maskingKey): self
    {
        return new self($clientPublicKey, $maskingKey, str_repeat("\0", self::ENVELOPE_LENGTH));
    }

    public function toBytes(): string
    {
        return $this->clientPublicKey.$this->maskingKey.$this->envelope;
    }

    /** @return array<string, never> */
    public function __debugInfo(): array
    {
        return [];
    }
}
