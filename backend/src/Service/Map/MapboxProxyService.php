<?php

declare(strict_types=1);

namespace App\Service\Map;

use App\Exception\ProxyDeniedException;
use App\Exception\RateLimitExceededException;
use Psr\Cache\CacheItemPoolInterface;
use Symfony\Component\RateLimiter\RateLimiterFactoryInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class MapboxProxyService
{
    /** @var string[] */
    private const array DROP_HEADERS = [
        'transfer-encoding', 'content-encoding', 'content-length',
        'connection', 'keep-alive', 'te', 'trailer', 'upgrade',
    ];

    public function __construct(
        private readonly array $allowedPatterns,
        private readonly CacheItemPoolInterface $mapboxProxyCache,
        private readonly RateLimiterFactoryInterface $mapboxProxySystemLimiter,
        private readonly HttpClientInterface $httpClient,
        private readonly string $mapboxToken,
    ) {
    }

    public function proxy(string $path, string $method, array $queryParams, ?string $body, string $contentType): ProxyResponse
    {
        $matched = $this->matchPattern($path, $method);

        $cacheKey = null;
        if ('GET' === $method) {
            $cacheKey = MapCacheKeyHelper::forProxyRequest($method, $path, $queryParams);
            $item = $this->mapboxProxyCache->getItem($cacheKey);
            if ($item->isHit()) {
                return $item->get();
            }
        }

        if ($matched['rate_limited']) {
            $this->consumeRateLimit();
        }

        $response = $this->callUpstream($path, $method, $queryParams, $body, $contentType);

        if (null !== $cacheKey && $this->isCacheable($response->status)) {
            $item = $this->mapboxProxyCache->getItem($cacheKey);
            $item->set($response);
            $this->mapboxProxyCache->save($item);
        }

        return $response;
    }

    /** @return 'tile'|'style'|null null: path is not allowed (the proxy denies it) */
    public function classify(string $path): ?string
    {
        try {
            return $this->matchPattern($path, 'GET')['rate_limited'] ? 'tile' : 'style';
        } catch (ProxyDeniedException) {
            return null;
        }
    }

    private function matchPattern(string $path, string $method): array
    {
        // The HTTP client removes dot segments ("styles/../geocoding" -> "geocoding"): they would lead
        // past the allow-listed prefix to any Mapbox API with the server token. It also treats encoded
        // dots ("%2e%2e", reaching here from a double-encoded request) as dot segments: check decoded.
        $decoded = $path;
        do {
            $previous = $decoded;
            $decoded = rawurldecode($decoded);
        } while ($decoded !== $previous);
        if (preg_match('#(^|/)\.{1,2}(/|$)#', $decoded) || str_contains($decoded, '\\')) {
            throw new ProxyDeniedException("Path not allowed: $path");
        }

        foreach ($this->allowedPatterns as $pattern) {
            if (
                preg_match('#'.$pattern['pattern'].'#', "/$path")
                && in_array($method, $pattern['methods'], true)
            ) {
                return $pattern;
            }
        }

        throw new ProxyDeniedException("Path not allowed: $path");
    }

    private function consumeRateLimit(): void
    {
        $limiter = $this->mapboxProxySystemLimiter->create('proxy-system');
        if (!$limiter->consume()->isAccepted()) {
            throw new RateLimitExceededException('Mapbox proxy rate limit exceeded');
        }
    }

    private function callUpstream(string $path, string $method, array $queryParams, ?string $body, string $contentType): ProxyResponse
    {
        $params = $queryParams;
        $params['access_token'] = $this->mapboxToken;
        $upstreamUrl = 'https://api.mapbox.com/'.$path.'?'.http_build_query($params);

        $options = [];
        if (in_array($method, ['POST', 'PUT', 'PATCH'], true) && null !== $body) {
            $options['body'] = $body;
            $options['headers']['Content-Type'] = $contentType;
        }

        $upstream = $this->httpClient->request($method, $upstreamUrl, $options);
        $status = $upstream->getStatusCode();

        $headers = [];
        foreach ($upstream->getHeaders(false) as $name => $values) {
            if (!in_array(strtolower($name), self::DROP_HEADERS, true)) {
                $headers[$name] = implode(', ', $values);
            }
        }

        return new ProxyResponse($status, $headers, $upstream->getContent(false));
    }

    private function isCacheable(int $status): bool
    {
        return ($status >= 200 && $status < 300) || 404 === $status || 410 === $status;
    }
}
