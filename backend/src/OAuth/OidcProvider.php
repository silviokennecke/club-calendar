<?php

declare(strict_types=1);

namespace App\OAuth;

use App\DependencyInjection\CachePoolAwareInterface;
use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessToken;
use Psr\Cache\CacheItemPoolInterface;
use Psr\Http\Message\ResponseInterface;
use Symfony\Component\Cache\Adapter\ArrayAdapter;

class OidcProvider extends GenericProvider implements CachePoolAwareInterface
{
    private const int CLOCK_LEEWAY = 120;

    private readonly string $issuer;
    private ?CacheItemPoolInterface $cache = null;
    private ?array $discovery = null;
    private readonly ?string $jwksUri;
    private ?IdTokenSignatureVerifier $verifier = null;

    public function __construct(array $options = [], array $collaborators = [])
    {
        if (!\array_key_exists('issuer', $options)) {
            throw new \InvalidArgumentException('Option "issuer" is required.');
        }

        $this->issuer = rtrim($options['issuer'] ?? '', '/');
        $this->jwksUri = $options['jwksUri'] ?? null;
        unset($options['issuer'], $options['jwksUri']);

        // GenericProvider requires these three; we override the methods so the stored values are never used
        $options['urlAuthorize'] ??= '';
        $options['urlAccessToken'] ??= '';
        $options['urlResourceOwnerDetails'] ??= '';

        parent::__construct($options, $collaborators);
    }

    public function setCache(CacheItemPoolInterface $cache): void
    {
        $this->cache = $cache;
    }

    public function getBaseAuthorizationUrl(): string
    {
        return $this->discover()['authorization_endpoint'];
    }

    public function getBaseAccessTokenUrl(array $params): string
    {
        return $this->discover()['token_endpoint'];
    }

    public function getResourceOwnerDetailsUrl(AccessToken $token): string
    {
        return $this->discover()['userinfo_endpoint'] ?? '';
    }

    public function getResourceOwner(AccessToken $token): OidcResourceOwner
    {
        $claims = $this->parseIdToken($token);
        $this->validateIdTokenClaims($claims);

        if (empty($claims['email']) && !empty($userInfoUrl = $this->getResourceOwnerDetailsUrl($token))) {
            try {
                $response = $this->fetchResourceOwnerDetails($token);
                $claims = array_merge($claims, $response);
            } catch (\Throwable) {
                // Fall back to ID token claims only
            }
        }

        return new OidcResourceOwner($claims);
    }

    private function discover(): array
    {
        if (null !== $this->discovery) {
            return $this->discovery;
        }

        if (null !== $this->cache) {
            $cacheKey = 'discovery_'.md5($this->issuer);
            $item = $this->cache->getItem($cacheKey);

            if ($item->isHit()) {
                return $this->discovery = $item->get();
            }

            $url = $this->issuer.'/.well-known/openid-configuration';
            $response = $this->getHttpClient()->request('GET', $url);
            $document = json_decode((string) $response->getBody(), true) ?? [];

            $ttl = $this->parseCacheTtl($response);
            if ($ttl > 0) {
                $item->set($document);
                $item->expiresAfter($ttl);
                $this->cache->save($item);
            }

            return $this->discovery = $document;
        }

        $url = $this->issuer.'/.well-known/openid-configuration';
        $response = $this->getHttpClient()->request('GET', $url);
        $this->discovery = json_decode((string) $response->getBody(), true) ?? [];

        return $this->discovery;
    }

    private function parseCacheTtl(ResponseInterface $response): int
    {
        $cacheControl = $response->getHeaderLine('Cache-Control');

        if (!empty($cacheControl)) {
            if (preg_match('/\b(?:no-store|no-cache)\b/i', $cacheControl)) {
                return 0;
            }
            if (preg_match('/\bmax-age\s*=\s*(\d+)/i', $cacheControl, $m)) {
                $age = (int) $response->getHeaderLine('Age');

                return max(0, (int) $m[1] - $age);
            }
        }

        $expires = $response->getHeaderLine('Expires');
        if (!empty($expires)) {
            $expiresAt = strtotime($expires);
            if (false !== $expiresAt && $expiresAt > time()) {
                return $expiresAt - (int) time();
            }
        }

        return 0;
    }

    /**
     * OIDC Core 3.1.3.7 claim checks (the signature is verified before, see verifySignature()).
     * No nonce is sent in the flow, so none is checked.
     * Messages never contain the token; the callers answer with oauth_failed.
     *
     * @param array<string, mixed> $claims
     */
    private function validateIdTokenClaims(array $claims): void
    {
        $now = time();

        if ([] === $claims) {
            throw new \UnexpectedValueException('ID token missing or malformed');
        }

        $iss = $claims['iss'] ?? null;
        if (!is_string($iss) || !in_array($iss, $this->expectedIssuers($claims), true)) {
            throw new \UnexpectedValueException('ID token issuer mismatch');
        }

        $aud = $claims['aud'] ?? null;
        $audiences = is_string($aud) ? [$aud] : (is_array($aud) ? $aud : []);
        if ('' === $this->clientId || !in_array($this->clientId, $audiences, true)) {
            throw new \UnexpectedValueException('ID token audience mismatch');
        }
        if (count($audiences) > 1 && ($claims['azp'] ?? null) !== $this->clientId) {
            throw new \UnexpectedValueException('ID token authorized party mismatch');
        }

        $exp = $claims['exp'] ?? null;
        if (!is_int($exp) && !is_float($exp)) {
            throw new \UnexpectedValueException('ID token has no expiry');
        }
        if ($exp + self::CLOCK_LEEWAY < $now) {
            throw new \UnexpectedValueException('ID token expired');
        }

        $iat = $claims['iat'] ?? null;
        if (null !== $iat && (!(is_int($iat) || is_float($iat)) || $iat - self::CLOCK_LEEWAY > $now)) {
            throw new \UnexpectedValueException('ID token issued in the future');
        }

        if (!is_string($claims['sub'] ?? null) || '' === $claims['sub']) {
            throw new \UnexpectedValueException('ID token has no subject');
        }
    }

    /**
     * @param array<string, mixed> $claims
     *
     * @return list<string>
     */
    private function expectedIssuers(array $claims): array
    {
        // Multi-tenant Microsoft endpoints: the token carries the issuing tenant's id
        if (1 === preg_match('#^(https://login\.microsoftonline\.com)/(?:common|organizations|consumers)/v2\.0$#', $this->issuer, $m)) {
            $tid = $claims['tid'] ?? null;
            if (!is_string($tid) || 1 !== preg_match('/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i', $tid)) {
                return [];
            }

            return [$m[1].'/'.$tid.'/v2.0'];
        }

        if ('https://accounts.google.com' === $this->issuer) {
            return ['https://accounts.google.com', 'accounts.google.com'];
        }

        return [$this->issuer];
    }

    private function parseIdToken(AccessToken $token): array
    {
        $idToken = $token->getValues()['id_token'] ?? null;
        if (!is_string($idToken)) {
            return [];
        }

        $parts = explode('.', $idToken);
        if (3 !== count($parts)) {
            return [];
        }

        $this->verifySignature($idToken);

        $padded = str_pad(strtr($parts[1], '-_', '+/'), (int) ceil(strlen($parts[1]) / 4) * 4, '=');
        $payload = base64_decode($padded, true);

        return false !== $payload ? (json_decode($payload, true) ?? []) : [];
    }

    private function verifySignature(string $idToken): void
    {
        if (null === $this->verifier) {
            $uri = $this->jwksUri ?? ($this->discover()['jwks_uri'] ?? null);
            if (!is_string($uri) || '' === $uri) {
                throw new \UnexpectedValueException('JWKS URI unknown');
            }
            $this->verifier = new IdTokenSignatureVerifier($this->getHttpClient(), $this->cache ?? new ArrayAdapter(), $uri);
        }

        $this->verifier->verify($idToken);
    }
}
