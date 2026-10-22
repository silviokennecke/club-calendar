<?php

declare(strict_types=1);

namespace App\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Which redirect URIs a dynamically registered client may use (`MCP_ALLOWED_CLIENTS`, comma-separated family
 * tokens; empty string = every client). Always required: https, or http on a loopback host; no fragment,
 * userinfo or wildcard. Families (rules from the MCP client research, re-verify before go-live):
 *
 * - claude: https://claude.ai/api/mcp/auth_callback; loopback /callback (Claude Code, any port)
 * - openai: https://chatgpt.com/connector_platform_oauth_redirect and https://chatgpt.com/connector/oauth/<id>
 * - gemini: loopback /oauth/callback (Gemini CLI, any port)
 * - grok: NO verified callback URL exists yet, so it accepts nothing until rules are added here
 *
 * Loopback ports are ignored when matching a family (RFC 8252 7.3).
 */
class RedirectUriPolicy
{
    /** Wildcard "family" returned when the allow-list is empty. */
    public const string ANY = '*';

    private const int MAX_LENGTH = 2048;
    private const array LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
    private const array FAMILIES = ['claude', 'openai', 'gemini', 'grok'];

    /** @var list<string> */
    private readonly array $allowed;

    public function __construct(#[Autowire(env: 'MCP_ALLOWED_CLIENTS')] string $allowedClients)
    {
        $allowed = [];
        foreach (explode(',', $allowedClients) as $token) {
            $token = strtolower(trim($token));
            if ('' === $token) {
                continue;
            }
            if (!in_array($token, self::FAMILIES, true)) {
                throw new \InvalidArgumentException(sprintf('Unknown MCP_ALLOWED_CLIENTS entry "%s" (known: %s)', $token, implode(', ', self::FAMILIES)));
            }
            $allowed[] = $token;
        }
        $this->allowed = $allowed;
    }

    /** True when every client may register (empty allow-list). */
    public function allowsAnyClient(): bool
    {
        return [] === $this->allowed;
    }

    /**
     * The family a redirect URI belongs to (`ANY` when the allow-list is empty), or null when it is not
     * acceptable.
     */
    public function match(string $uri): ?string
    {
        $parts = self::parse($uri);
        if (null === $parts) {
            return null;
        }
        if ($this->allowsAnyClient()) {
            return self::ANY;
        }
        foreach ($this->allowed as $family) {
            if ($this->matchesFamily($family, $parts)) {
                return $family;
            }
        }

        return null;
    }

    /**
     * @return array{scheme: string, host: string, path: string, query: ?string, loopback: bool, port: bool}|null
     */
    private static function parse(string $uri): ?array
    {
        if ('' === $uri || strlen($uri) > self::MAX_LENGTH || 1 === preg_match('/[\x00-\x20\x7f*\\\\]/', $uri) || str_contains($uri, '#')) {
            return null;
        }
        $p = parse_url($uri);
        if (!is_array($p) || isset($p['user']) || isset($p['pass']) || isset($p['fragment'])) {
            return null;
        }
        $scheme = strtolower($p['scheme'] ?? '');
        $host = strtolower($p['host'] ?? '');
        if ('' === $host || !in_array($scheme, ['http', 'https'], true)) {
            return null;
        }
        $loopback = in_array($host, self::LOOPBACK_HOSTS, true);
        if ('http' === $scheme && !$loopback) {
            return null;
        }
        if ('https' === $scheme && $loopback) {
            return null;
        }
        if (isset($p['port']) && ($p['port'] < 1 || $p['port'] > 65535)) {
            return null;
        }

        return [
            'scheme' => $scheme,
            'host' => $host,
            'path' => $p['path'] ?? '',
            'query' => $p['query'] ?? null,
            'port' => isset($p['port']),
            'loopback' => $loopback,
        ];
    }

    /** @param array{scheme: string, host: string, path: string, query: ?string, loopback: bool, port: bool} $u */
    private function matchesFamily(string $family, array $u): bool
    {
        if (null !== $u['query']) {
            return false;
        }
        $hosted = !$u['loopback'] && !$u['port'] ? $u['scheme'].'://'.$u['host'].$u['path'] : null;

        return match ($family) {
            'claude' => $u['loopback'] ? '/callback' === $u['path'] : 'https://claude.ai/api/mcp/auth_callback' === $hosted,
            'gemini' => $u['loopback'] && '/oauth/callback' === $u['path'],
            'openai' => null !== $hosted && (
                'https://chatgpt.com/connector_platform_oauth_redirect' === $hosted
                || 1 === preg_match('~^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$~', $hosted)
            ),
            default => false,
        };
    }
}
