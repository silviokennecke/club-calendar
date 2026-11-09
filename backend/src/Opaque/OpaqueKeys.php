<?php

declare(strict_types=1);

namespace App\Opaque;

/**
 * Server secrets of the OPAQUE setup (OPRF seed 64 B, server private key 32 B ristretto255 scalar), passed as
 * unpadded base64url. Validated eagerly when enabled; when disabled nothing is read and accessors throw.
 */
final class OpaqueKeys
{
    public const int SEED_LENGTH = 64;
    public const int PRIVATE_KEY_LENGTH = 32;

    private ?string $oprfSeed = '';
    private ?string $serverPrivateKey = '';
    private string $serverPublicKey = '';

    public function __construct(
        private readonly bool $enabled,
        #[\SensitiveParameter] string $oprfSeed,
        #[\SensitiveParameter] string $serverPrivateKey,
    ) {
        if (!$enabled) {
            return;
        }

        $seed = self::decode($oprfSeed, self::SEED_LENGTH, 'OPAQUE_OPRF_SEED');
        $private = self::decode($serverPrivateKey, self::PRIVATE_KEY_LENGTH, 'OPAQUE_SERVER_PRIVATE_KEY');

        // Canonical (< group order) iff reducing the zero-extended bytes returns them unchanged.
        $reduced = substr(sodium_crypto_core_ristretto255_scalar_reduce($private.str_repeat("\0", 32)), 0, 32);
        if (!hash_equals($reduced, $private) || hash_equals(str_repeat("\0", 32), $private)) {
            throw new OpaqueException('OPAQUE_SERVER_PRIVATE_KEY is not a canonical non-zero ristretto255 scalar.');
        }

        $this->oprfSeed = $seed;
        $this->serverPrivateKey = $private;
        $this->serverPublicKey = sodium_crypto_scalarmult_ristretto255_base($private);
    }

    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    public function oprfSeed(): string
    {
        $this->assertEnabled();

        return $this->oprfSeed ?? '';
    }

    public function serverPrivateKey(): string
    {
        $this->assertEnabled();

        return $this->serverPrivateKey ?? '';
    }

    public function serverPublicKey(): string
    {
        $this->assertEnabled();

        return $this->serverPublicKey;
    }

    public static function encode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** @return array<string, never> */
    public function __debugInfo(): array
    {
        return [];
    }

    /** @return never */
    public function __serialize(): array
    {
        throw new \LogicException('OpaqueKeys must not be serialized.');
    }

    public function __unserialize(array $data): void
    {
        throw new \LogicException('OpaqueKeys must not be unserialized.');
    }

    public function __destruct()
    {
        // Best-effort: sodium_memzero acts on this property only; copies handed out by the accessors are not reached.
        if (null !== $this->oprfSeed && '' !== $this->oprfSeed) {
            sodium_memzero($this->oprfSeed);
        }
        if (null !== $this->serverPrivateKey && '' !== $this->serverPrivateKey) {
            sodium_memzero($this->serverPrivateKey);
        }
    }

    private function assertEnabled(): void
    {
        if (!$this->enabled) {
            throw new OpaqueException('OPAQUE is disabled (OPAQUE_ENABLED=false).');
        }
    }

    private static function decode(#[\SensitiveParameter] string $value, int $length, string $name): string
    {
        $fail = static fn (): OpaqueException => new OpaqueException(sprintf(
            '%s is missing or invalid: expected %d bytes as unpadded base64url (generate with app:opaque:generate-keys).',
            $name,
            $length,
        ));

        if ('' === $value || 1 !== preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
            throw $fail();
        }
        $bytes = base64_decode(strtr($value, '-_', '+/'), true);
        if (false === $bytes || self::encode($bytes) !== $value || strlen($bytes) !== $length) {
            throw $fail();
        }

        return $bytes;
    }
}
