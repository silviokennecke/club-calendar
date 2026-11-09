<?php

declare(strict_types=1);

namespace App\Opaque;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Uid\Uuid;

/**
 * Seals the server state between KE2 and KE3 into an opaque blob the client carries (XChaCha20-Poly1305, key from
 * APP_SECRET via HKDF with a dedicated label; the state holds the expected client MAC, so it is encrypted, never
 * merely signed). Fixed plaintext layout, so real and fake-path blobs have the same size: state (128) | jti (16) |
 * expiry u64 (8) | purpose, NUL padded (32) | fake flag (1) | user id as binary UUID (16, random if fake) |
 * token version u64 (8) | record hash (32, zero if fake).
 */
final readonly class LoginStateSealer
{
    public const int PURPOSE_LENGTH = 32;
    public const int HASH_LENGTH = 32;
    private const string AD = "club-calendar/opaque-login-state\x02";
    private const int PLAIN_LENGTH = ServerLoginState::LENGTH + 16 + 8 + self::PURPOSE_LENGTH + 1 + 16 + 8 + self::HASH_LENGTH;

    public function __construct(
        #[Autowire(env: 'APP_SECRET')]
        #[\SensitiveParameter]
        private string $secret,
    ) {
    }

    /** @param ?string $userId null = fake-path state, which can never complete a login */
    public function seal(ServerLoginState $state, string $purpose, ?string $userId, int $tokenVersion, string $recordHash, int $expiresAt): string
    {
        if ('' === $purpose || strlen($purpose) > self::PURPOSE_LENGTH || self::HASH_LENGTH !== strlen($recordHash) || $tokenVersion < 0) {
            throw new OpaqueException('Invalid login state fields.');
        }
        $fake = null === $userId;
        $plain = $state->toBytes()
            .random_bytes(16)
            .pack('J', $expiresAt)
            .str_pad($purpose, self::PURPOSE_LENGTH, "\0")
            .($fake ? "\1" : "\0")
            .($fake ? random_bytes(16) : self::uuidToBinary($userId))
            .pack('J', $fake ? 0 : $tokenVersion)
            .($fake ? str_repeat("\0", self::HASH_LENGTH) : $recordHash);
        $nonce = random_bytes(\SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);
        $key = $this->key();
        $sealed = $nonce.sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($plain, self::AD, $nonce, $key);
        sodium_memzero($key);
        sodium_memzero($plain);

        return rtrim(strtr(base64_encode($sealed), '+/', '-_'), '=');
    }

    /** @throws InvalidMessageException on any malformed, forged or foreign blob */
    public function open(string $blob): OpenedLoginState
    {
        $raw = 1 === preg_match('/^[A-Za-z0-9_-]+$/', $blob) ? base64_decode(strtr($blob, '-_', '+/'), true) : false;
        $nonceLen = \SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES;
        if (false === $raw || strlen($raw) !== $nonceLen + self::PLAIN_LENGTH + \SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_ABYTES) {
            throw new InvalidMessageException('Invalid login state.');
        }
        $key = $this->key();
        $plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(substr($raw, $nonceLen), self::AD, substr($raw, 0, $nonceLen), $key);
        sodium_memzero($key);
        if (false === $plain || self::PLAIN_LENGTH !== strlen($plain)) {
            throw new InvalidMessageException('Invalid login state.');
        }

        $opened = new OpenedLoginState(
            ServerLoginState::fromBytes(substr($plain, 0, 128)),
            substr($plain, 128, 16),
            unpack('J', substr($plain, 144, 8))[1],
            rtrim(substr($plain, 152, self::PURPOSE_LENGTH), "\0"),
            "\1" === $plain[184],
            Uuid::fromBinary(substr($plain, 185, 16))->toRfc4122(),
            unpack('J', substr($plain, 201, 8))[1],
            substr($plain, 209, self::HASH_LENGTH),
        );
        sodium_memzero($plain);

        return $opened;
    }

    private static function uuidToBinary(string $uuid): string
    {
        if (!Uuid::isValid($uuid)) {
            throw new OpaqueException('Invalid login state fields.');
        }

        return Uuid::fromString($uuid)->toBinary();
    }

    private function key(): string
    {
        $prk = Hkdf::extract('club-calendar/opaque-login-state', $this->secret);

        return Hkdf::expand($prk, 'login-state-key', \SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_KEYBYTES);
    }
}
