<?php

declare(strict_types=1);

namespace App\Opaque;

/**
 * Server key sets of the OPAQUE setup, each with an id: OPRF seed (64 B) and server private key (32 B ristretto255
 * scalar) as unpadded base64url. Sources: OPAQUE_KEYS (`id:seed:privateKey,...`) and the legacy pair
 * OPAQUE_OPRF_SEED/OPAQUE_SERVER_PRIVATE_KEY (= id "1", so single-key deployments need no change). New registrations use
 * the active id (OPAQUE_ACTIVE_KEY_ID, default "1"); stored records name their key in user.opaque_key_id.
 * Validated eagerly: missing or invalid keys fail construction.
 */
final class OpaqueKeys
{
    public const int SEED_LENGTH = 64;
    public const int PRIVATE_KEY_LENGTH = 32;
    public const string LEGACY_ID = '1';
    private const string ID_PATTERN = '/^[A-Za-z0-9_.-]{1,16}$/';

    /** @var array<string, array{seed: string, private: string, public: string}> */
    private array $sets = [];
    private string $activeId = '';

    public function __construct(
        #[\SensitiveParameter] string $oprfSeed,
        #[\SensitiveParameter] string $serverPrivateKey,
        #[\SensitiveParameter] string $keySets = '',
        string $activeKeyId = '',
    ) {
        $hasKeySets = '' !== trim($keySets);
        if ('' !== $oprfSeed || '' !== $serverPrivateKey || !$hasKeySets) {
            $this->add(self::LEGACY_ID, $oprfSeed, $serverPrivateKey, 'OPAQUE_OPRF_SEED', 'OPAQUE_SERVER_PRIVATE_KEY');
        }
        if ($hasKeySets) {
            foreach (explode(',', $keySets) as $entry) {
                $parts = explode(':', trim($entry));
                if (3 !== count($parts) || 1 !== preg_match(self::ID_PATTERN, $parts[0])) {
                    throw new OpaqueException('OPAQUE_KEYS is invalid: expected comma-separated id:seed:privateKey entries with ids of 1-16 characters [A-Za-z0-9_.-].');
                }
                if (isset($this->sets[$parts[0]])) {
                    throw new OpaqueException(sprintf('OPAQUE_KEYS: key id "%s" is defined twice (id "1" is also the legacy OPAQUE_OPRF_SEED pair).', $parts[0]));
                }
                $this->add($parts[0], $parts[1], $parts[2], sprintf('OPAQUE_KEYS[%s] seed', $parts[0]), sprintf('OPAQUE_KEYS[%s] private key', $parts[0]));
            }
        }

        $active = '' === $activeKeyId ? self::LEGACY_ID : $activeKeyId;
        if (!isset($this->sets[$active])) {
            throw new OpaqueException(sprintf('OPAQUE_ACTIVE_KEY_ID "%s" is not a configured key id (configured: %s).', $active, implode(', ', array_keys($this->sets))));
        }
        $this->activeId = $active;
    }

    public function activeId(): string
    {
        return $this->activeId;
    }

    /** @return list<string> */
    public function ids(): array
    {
        return array_map('strval', array_keys($this->sets));
    }

    public function has(string $id): bool
    {
        return isset($this->sets[$id]);
    }

    /** Seed of the key id (default: the active key). */
    public function oprfSeed(?string $id = null): string
    {
        return $this->set($id)['seed'];
    }

    public function serverPrivateKey(?string $id = null): string
    {
        return $this->set($id)['private'];
    }

    public function serverPublicKey(?string $id = null): string
    {
        return $this->set($id)['public'];
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
        // Best-effort: sodium_memzero acts on these copies only; values handed out by the accessors are not reached.
        foreach ($this->sets as &$set) {
            sodium_memzero($set['seed']);
            sodium_memzero($set['private']);
        }
    }

    /** @return array{seed: string, private: string, public: string} */
    private function set(?string $id): array
    {
        $set = $this->sets[$id ?? $this->activeId] ?? null;
        if (null === $set) {
            throw new OpaqueException(sprintf('Unknown OPAQUE key id "%s".', $id));
        }

        return $set;
    }

    private function add(string $id, #[\SensitiveParameter] string $seedValue, #[\SensitiveParameter] string $privateValue, string $seedName, string $privateName): void
    {
        $seed = self::decode($seedValue, self::SEED_LENGTH, $seedName);
        $private = self::decode($privateValue, self::PRIVATE_KEY_LENGTH, $privateName);

        // Canonical (< group order) iff reducing the zero-extended bytes returns them unchanged.
        $reduced = substr(sodium_crypto_core_ristretto255_scalar_reduce($private.str_repeat("\0", 32)), 0, 32);
        if (!hash_equals($reduced, $private) || hash_equals(str_repeat("\0", 32), $private)) {
            throw new OpaqueException($privateName.' is not a canonical non-zero ristretto255 scalar.');
        }

        $this->sets[$id] = ['seed' => $seed, 'private' => $private, 'public' => sodium_crypto_scalarmult_ristretto255_base($private)];
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
