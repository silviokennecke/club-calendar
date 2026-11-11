<?php

declare(strict_types=1);

namespace App\Security\Secret;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Authenticated encryption (XChaCha20-Poly1305, ext-sodium) of secrets stored in the database (feed secrets,
 * personal subscription secrets). The key is HKDF-SHA256 of APP_SECRET with a fixed context label, so the raw
 * APP_SECRET is never used as a key. The purpose (e.g. `feed.shared_secret`) is the associated data: a value copied
 * into another column does not decrypt.
 *
 * Format: `enc:v1:<keyId>:<base64url(nonce|ciphertext)>`; keyId is a fingerprint of the derived key. After a
 * rotation the older APP_SECRET values (`APP_SECRET_PREVIOUS`, comma-separated) stay in the key ring for reading.
 * A value without the `enc:` prefix is legacy plaintext: it is read as is and encrypted on the next write.
 */
final class SecretCipher
{
    public const string PURPOSE_FEED = 'feed.shared_secret';
    public const string PURPOSE_SUBSCRIPTION = 'member_subscription.secret';
    public const string PURPOSE_TOTP = 'user_totp.secret';

    private const string PREFIX = 'enc:';
    private const string VERSION = 'v1';
    private const string KDF_CONTEXT = 'club-calendar/secret-cipher/v1';

    /** @var array<string, string> keyId => derived key */
    private array $ring = [];
    private string $currentKeyId;

    public function __construct(
        #[Autowire(env: 'APP_SECRET')]
        string $secret,
        #[Autowire(env: 'APP_SECRET_PREVIOUS')]
        string $previousSecrets = '',
    ) {
        $this->currentKeyId = $this->addKey($secret);
        foreach (explode(',', $previousSecrets) as $old) {
            $old = trim($old);
            if ('' !== $old) {
                $this->addKey($old);
            }
        }
    }

    public function encrypt(string $plaintext, string $purpose): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);
        $cipher = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($plaintext, $this->associatedData($purpose), $nonce, $this->ring[$this->currentKeyId]);

        return self::PREFIX.self::VERSION.':'.$this->currentKeyId.':'.self::base64UrlEncode($nonce.$cipher);
    }

    /** @throws SecretCipherException unknown key id, unsupported format or failed authentication */
    public function decrypt(string $stored, string $purpose): string
    {
        if (!self::isEncrypted($stored)) {
            return $stored;
        }
        $parts = explode(':', $stored, 4);
        if (4 !== count($parts) || self::VERSION !== $parts[1]) {
            throw new SecretCipherException('Unsupported encrypted secret format.');
        }
        [, , $keyId, $payload] = $parts;
        if (!isset($this->ring[$keyId])) {
            throw new SecretCipherException(sprintf('Secret is encrypted with unknown key "%s": set the matching old APP_SECRET in APP_SECRET_PREVIOUS.', $keyId));
        }
        $raw = self::base64UrlDecode($payload);
        $nonceLength = SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES;
        if (null === $raw || strlen($raw) < $nonceLength + SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_ABYTES) {
            throw new SecretCipherException('Encrypted secret is malformed.');
        }
        $plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(substr($raw, $nonceLength), $this->associatedData($purpose), substr($raw, 0, $nonceLength), $this->ring[$keyId]);
        if (false === $plain) {
            throw new SecretCipherException('Encrypted secret failed authentication (tampered or wrong column).');
        }

        return $plain;
    }

    public static function isEncrypted(string $stored): bool
    {
        return str_starts_with($stored, self::PREFIX);
    }

    /** True for a value encrypted with the current key (not legacy plaintext, not an older key). */
    public function usesCurrentKey(string $stored): bool
    {
        return str_starts_with($stored, self::PREFIX.self::VERSION.':'.$this->currentKeyId.':');
    }

    private function addKey(string $secret): string
    {
        if ('' === $secret) {
            throw new \InvalidArgumentException('APP_SECRET must not be empty.');
        }
        $key = hash_hkdf('sha256', $secret, SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_KEYBYTES, self::KDF_CONTEXT);
        $id = substr(hash_hmac('sha256', 'key-id', $key), 0, 8);
        $this->ring[$id] = $key;

        return $id;
    }

    private function associatedData(string $purpose): string
    {
        return self::KDF_CONTEXT.'|'.$purpose;
    }

    private static function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $text): ?string
    {
        $raw = base64_decode(strtr($text, '-_', '+/'), true);

        return false === $raw ? null : $raw;
    }
}
