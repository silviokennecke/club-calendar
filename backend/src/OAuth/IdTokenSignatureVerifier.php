<?php

declare(strict_types=1);

namespace App\OAuth;

use GuzzleHttp\ClientInterface;
use Lcobucci\JWT\Encoding\JoseEncoder;
use Lcobucci\JWT\Signer\Key\InMemory;
use Lcobucci\JWT\Signer\Rsa\Sha256;
use Lcobucci\JWT\Token\Parser;
use Lcobucci\JWT\Validation\Constraint\SignedWith;
use Lcobucci\JWT\Validation\Validator;
use Psr\Cache\CacheItemPoolInterface;

/**
 * Verifies the signature of an OIDC ID token against the provider's JWKS (fixed URL, never taken from the token).
 * Only RS256 is accepted. Messages never contain the token.
 */
final class IdTokenSignatureVerifier
{
    private const string ALGORITHM = 'RS256';
    private const int KEYS_TTL = 3600;
    private const int REFRESH_THROTTLE = 60;
    private const int MIN_MODULUS_BITS = 2048;

    public function __construct(
        private readonly ClientInterface $http,
        private readonly CacheItemPoolInterface $cache,
        private readonly string $jwksUri,
    ) {
        if (!str_starts_with($jwksUri, 'https://')) {
            throw new \InvalidArgumentException('JWKS URI must use https.');
        }
    }

    public function verify(string $idToken): void
    {
        $header = $this->decodeHeader($idToken);
        if (self::ALGORITHM !== ($header['alg'] ?? null)) {
            throw new \UnexpectedValueException('ID token algorithm not allowed');
        }
        $kid = $header['kid'] ?? null;
        if (!is_string($kid) || '' === $kid) {
            throw new \UnexpectedValueException('ID token has no key id');
        }

        $keys = $this->keys();
        $jwk = $this->find($keys, $kid);
        if (null === $jwk) {
            // Key rotation: one forced refetch per throttle window, so a forged kid cannot cause a fetch per request
            $throttle = $this->cache->getItem($this->key('refresh'));
            if ($throttle->isHit() || $this->lastFetchWasFresh) {
                throw new \UnexpectedValueException('ID token key id unknown');
            }
            $throttle->set(true)->expiresAfter(self::REFRESH_THROTTLE);
            $this->cache->save($throttle);
            $jwk = $this->find($this->keys(true), $kid);
            if (null === $jwk) {
                throw new \UnexpectedValueException('ID token key id unknown');
            }
        }

        try {
            $token = (new Parser(new JoseEncoder()))->parse($idToken);
            $ok = (new Validator())->validate($token, new SignedWith(new Sha256(), InMemory::plainText($this->toPem($jwk))));
        } catch (\Throwable) {
            throw new \UnexpectedValueException('ID token signature invalid');
        }
        if (!$ok) {
            throw new \UnexpectedValueException('ID token signature invalid');
        }
    }

    private bool $lastFetchWasFresh = false;

    /** @return list<array<string, mixed>> */
    private function keys(bool $force = false): array
    {
        $item = $this->cache->getItem($this->key('keys'));
        if (!$force && $item->isHit()) {
            $this->lastFetchWasFresh = false;

            return $item->get();
        }

        try {
            $response = $this->http->request('GET', $this->jwksUri, ['timeout' => 5, 'connect_timeout' => 5, 'allow_redirects' => false]);
            $doc = json_decode((string) $response->getBody(), true, 8);
        } catch (\Throwable) {
            throw new \UnexpectedValueException('JWKS could not be fetched');
        }
        if (!is_array($doc) || !is_array($doc['keys'] ?? null)) {
            throw new \UnexpectedValueException('JWKS malformed');
        }

        $keys = array_values(array_filter($doc['keys'], 'is_array'));
        $item->set($keys)->expiresAfter(self::KEYS_TTL);
        $this->cache->save($item);
        $this->lastFetchWasFresh = true;

        return $keys;
    }

    /**
     * @param list<array<string, mixed>> $keys
     *
     * @return array<string, mixed>|null
     */
    private function find(array $keys, string $kid): ?array
    {
        foreach ($keys as $jwk) {
            if (($jwk['kid'] ?? null) === $kid
                && 'RSA' === ($jwk['kty'] ?? null)
                && (!isset($jwk['alg']) || self::ALGORITHM === $jwk['alg'])
                && (!isset($jwk['use']) || 'sig' === $jwk['use'])
                && is_string($jwk['n'] ?? null) && is_string($jwk['e'] ?? null)) {
                return $jwk;
            }
        }

        return null;
    }

    /** @return array<string, mixed> */
    private function decodeHeader(string $jwt): array
    {
        $parts = explode('.', $jwt);
        if (3 !== count($parts)) {
            throw new \UnexpectedValueException('ID token malformed');
        }
        $json = $this->b64($parts[0]);
        $header = null !== $json ? json_decode($json, true) : null;
        if (!is_array($header)) {
            throw new \UnexpectedValueException('ID token malformed');
        }

        return $header;
    }

    private function b64(string $value): ?string
    {
        $padded = str_pad(strtr($value, '-_', '+/'), (int) ceil(strlen($value) / 4) * 4, '=');
        $out = base64_decode($padded, true);

        return false === $out ? null : $out;
    }

    /** @param array<string, mixed> $jwk */
    private function toPem(array $jwk): string
    {
        $n = $this->b64($jwk['n']);
        $e = $this->b64($jwk['e']);
        if (null === $n || null === $e || '' === $n || '' === $e || strlen(ltrim($n, "\0")) * 8 < self::MIN_MODULUS_BITS) {
            throw new \UnexpectedValueException('JWK invalid');
        }

        $rsaKey = $this->der(0x30, $this->derInt($n).$this->derInt($e));
        $algorithm = $this->der(0x30, "\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00");
        $spki = $this->der(0x30, $algorithm.$this->der(0x03, "\0".$rsaKey));

        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($spki), 64, "\n")."-----END PUBLIC KEY-----\n";
    }

    private function derInt(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ('' === $bytes || ord($bytes[0]) > 0x7F) {
            $bytes = "\0".$bytes;
        }

        return $this->der(0x02, $bytes);
    }

    private function der(int $tag, string $content): string
    {
        $len = strlen($content);
        if ($len < 0x80) {
            $lenBytes = chr($len);
        } else {
            $hex = ltrim(pack('N', $len), "\0");
            $lenBytes = chr(0x80 | strlen($hex)).$hex;
        }

        return chr($tag).$lenBytes.$content;
    }

    private function key(string $what): string
    {
        return 'jwks_'.$what.'_'.md5($this->jwksUri);
    }
}
