<?php
declare(strict_types=1);

namespace App\OAuth;

use App\DependencyInjection\CachePoolAwareInterface;
use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessToken;
use Psr\Cache\CacheItemPoolInterface;
use Psr\Http\Message\ResponseInterface;

class OidcProvider extends GenericProvider implements CachePoolAwareInterface
{
    private readonly string $issuer;
    private readonly array $defaultAuthorizationParams;
    private ?CacheItemPoolInterface $cache = null;
    private ?array $discovery = null;

    public function __construct(array $options = [], array $collaborators = [])
    {
        $this->issuer                     = rtrim($options['issuer'] ?? '', '/');
        $this->defaultAuthorizationParams = $options['defaultAuthorizationParams'] ?? [];

        unset($options['defaultAuthorizationParams']);

        // GenericProvider requires these three; we override the methods so the stored values are never used
        $options['urlAuthorize']            ??= '';
        $options['urlAccessToken']          ??= '';
        $options['urlResourceOwnerDetails'] ??= '';

        parent::__construct($options, $collaborators);
    }

    public function setCache(CacheItemPoolInterface $cache): void
    {
        $this->cache = $cache;
    }

    protected function getRequiredOptions(): array
    {
        return ['issuer'];
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

    public function buildAuthorizationUrl(array $options = []): string
    {
        return parent::buildAuthorizationUrl(array_merge($this->defaultAuthorizationParams, $options));
    }

    public function getResourceOwner(AccessToken $token): OidcResourceOwner
    {
        $claims = $this->parseIdToken($token);

        $userInfoUrl = $this->getResourceOwnerDetailsUrl($token);
        if (empty($claims['email']) && !empty($userInfoUrl)) {
            try {
                $response = $this->fetchResourceOwnerDetails($token);
                $claims   = array_merge($claims, $response);
            } catch (\Throwable) {
                // Fall back to ID token claims only
            }
        }

        return new OidcResourceOwner($claims);
    }

    private function discover(): array
    {
        if ($this->discovery !== null) {
            return $this->discovery;
        }

        if ($this->cache !== null) {
            $cacheKey = 'discovery_' . md5($this->issuer);
            $item     = $this->cache->getItem($cacheKey);

            if ($item->isHit()) {
                return $this->discovery = $item->get();
            }

            $url      = $this->issuer . '/.well-known/openid-configuration';
            $response = $this->getHttpClient()->get($url);
            $document = json_decode((string) $response->getBody(), true) ?? [];

            $ttl = $this->parseCacheTtl($response);
            if ($ttl > 0) {
                $item->set($document);
                $item->expiresAfter($ttl);
                $this->cache->save($item);
            }

            return $this->discovery = $document;
        }

        $url             = $this->issuer . '/.well-known/openid-configuration';
        $response        = $this->getHttpClient()->get($url);
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
            if ($expiresAt !== false && $expiresAt > time()) {
                return $expiresAt - (int) time();
            }
        }

        return 0;
    }

    private function parseIdToken(AccessToken $token): array
    {
        $idToken = $token->getValues()['id_token'] ?? null;
        if (!is_string($idToken)) {
            return [];
        }

        $parts = explode('.', $idToken);
        if (count($parts) !== 3) {
            return [];
        }

        $padded  = str_pad(strtr($parts[1], '-_', '+/'), (int) ceil(strlen($parts[1]) / 4) * 4, '=');
        $payload = base64_decode($padded, true);

        return $payload !== false ? (json_decode($payload, true) ?? []) : [];
    }
}
