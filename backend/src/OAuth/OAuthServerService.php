<?php

declare(strict_types=1);

namespace App\OAuth;

use App\Entity\McpGrant;
use App\Entity\McpToken;
use App\Entity\OAuthAuthorizationCode;
use App\Entity\OAuthAuthorizationRequest;
use App\Entity\OAuthClient;
use App\Entity\User;
use App\Repository\McpGrantRepository;
use App\Repository\McpTokenRepository;
use App\Repository\OAuthAuthorizationCodeRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * The OAuth 2.1 authorization server behind the MCP endpoint (no HTTP here): authorization requests, codes
 * (PKCE S256 only), opaque access/refresh tokens (only SHA-256 hashes stored) and grants. The refresh logic
 * mirrors AuthService::refresh: single-use rotation by a conditional UPDATE, reuse detection that revokes the
 * grant, a short grace window and an absolute lifetime.
 */
class OAuthServerService
{
    private const string FORMAT = 'Y-m-d H:i:s';
    /** `last_used_at` is written at most this often per token/grant. */
    private const int TOUCH_INTERVAL = 60;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly McpTokenRepository $tokens,
        private readonly McpGrantRepository $grants,
        private readonly OAuthAuthorizationCodeRepository $codes,
        #[Autowire(env: 'APP_URL')]
        private readonly string $appUrl,
        #[Autowire(env: 'int:MCP_ACCESS_TOKEN_TTL')]
        private readonly int $accessTtl,
        #[Autowire(env: 'int:MCP_REFRESH_TOKEN_LIFETIME')]
        private readonly int $refreshLifetime,
        #[Autowire(env: 'int:MCP_REFRESH_TOKEN_ABSOLUTE_LIFETIME')]
        private readonly int $absoluteLifetime,
        #[Autowire(env: 'int:MCP_REFRESH_TOKEN_REUSE_GRACE')]
        private readonly int $reuseGrace,
    ) {
    }

    /** The audience every token is bound to (RFC 8707), `APP_URL/api/mcp`. */
    public function canonicalResource(): string
    {
        return rtrim($this->appUrl, '/').'/api/mcp';
    }

    /**
     * Validates and stores an authorization request for the consent page. The client and redirect URI must
     * already be trusted by the caller only in the sense of the registered list: the redirect URI is matched
     * against it here (exact; for loopback http URIs the port is ignored, RFC 8252 7.3).
     *
     * @throws OAuthException
     */
    public function createAuthorizationRequest(
        OAuthClient $client,
        string $redirectUri,
        ?string $scope,
        string $codeChallenge,
        ?string $codeChallengeMethod,
        ?string $state,
        ?string $resource,
    ): OAuthAuthorizationRequest {
        if (!$this->redirectUriRegistered($client, $redirectUri)) {
            throw new OAuthException(OAuthException::INVALID_REQUEST, 'redirect_uri is not registered for this client');
        }
        if ('S256' !== $codeChallengeMethod) {
            throw new OAuthException(OAuthException::INVALID_REQUEST, 'code_challenge_method must be S256');
        }
        if (1 !== preg_match('/^[A-Za-z0-9_-]{43}$/', $codeChallenge)) {
            throw new OAuthException(OAuthException::INVALID_REQUEST, 'code_challenge must be a base64url SHA-256 digest');
        }
        if (null !== $state && strlen($state) > 2048) {
            throw new OAuthException(OAuthException::INVALID_REQUEST, 'state is too long');
        }
        $scopes = null === $scope || '' === trim($scope) ? [McpScope::Read] : McpScope::parse($scope);
        if (null === $scopes) {
            throw new OAuthException(OAuthException::INVALID_SCOPE, 'Unknown scope');
        }
        $request = new OAuthAuthorizationRequest(
            $client,
            $redirectUri,
            McpScope::toString($scopes),
            $codeChallenge,
            $state,
            $this->checkResource($resource),
            $this->now(),
        );
        $this->em->persist($request);
        $this->em->flush();

        return $request;
    }

    /**
     * The user allowed the request: creates the grant and a one-time code (single use, answered request is gone).
     *
     * @return array{code: string, redirectUri: string, state: ?string}
     *
     * @throws OAuthException
     */
    public function approve(OAuthAuthorizationRequest $request, User $user): array
    {
        $now = $this->now();
        $code = $this->randomToken();

        $this->em->wrapInTransaction(function () use ($request, $user, $now, $code): void {
            if (1 !== $this->em->getConnection()->executeStatement('DELETE FROM oauth_authorization_request WHERE id = ? AND expires_at > ?', [$request->getId(), $this->utc($now)])) {
                throw new OAuthException(OAuthException::INVALID_REQUEST, 'The authorization request is unknown, expired or already answered');
            }
            $this->em->detach($request);
            $grant = new McpGrant($user, $request->getClient(), $request->getScopes(), $now, $now->modify(sprintf('+%d seconds', $this->absoluteLifetime)));
            $this->em->persist($grant);
            $this->em->persist(new OAuthAuthorizationCode(self::hash($code), $grant, $request->getRedirectUri(), $request->getCodeChallenge(), $request->getResource(), $now));
        });

        return ['code' => $code, 'redirectUri' => $request->getRedirectUri(), 'state' => $request->getState()];
    }

    /** The user denied the request (or it is dropped): removes it. */
    public function deny(OAuthAuthorizationRequest $request): void
    {
        $this->em->getConnection()->executeStatement('DELETE FROM oauth_authorization_request WHERE id = ?', [$request->getId()]);
        $this->em->detach($request);
    }

    /**
     * Redeems an authorization code for the first token pair.
     *
     * @return array{access_token: string, token_type: string, expires_in: int, refresh_token: string, scope: string}
     *
     * @throws OAuthException
     */
    public function exchangeCode(OAuthClient $client, string $code, string $redirectUri, string $codeVerifier, ?string $resource): array
    {
        $now = $this->now();
        $entity = '' === $code ? null : $this->codes->findOneByHash(self::hash($code));
        $grant = $entity?->getGrant();
        if (null === $entity || null === $grant || $grant->getClient()->getId() !== $client->getId()) {
            throw self::invalidGrant('Invalid authorization code');
        }
        $this->em->refresh($grant);
        // Take the code first: of any number of concurrent redemptions exactly one wins, every other one is reuse.
        $won = 1 === $this->em->getConnection()->executeStatement(
            'UPDATE oauth_authorization_code SET used_at = ? WHERE id = ? AND used_at IS NULL',
            [$this->utc($now), $entity->getId()],
        );
        if (!$won) {
            $this->revokeGrant($grant);
            throw self::invalidGrant('Authorization code already used');
        }
        if ($entity->getExpiresAt() <= $now || $this->grantEnded($grant, $now)) {
            throw self::invalidGrant('Authorization code expired');
        }
        if (!hash_equals($entity->getRedirectUri(), $redirectUri)) {
            throw self::invalidGrant('redirect_uri does not match the authorization request');
        }
        if (1 !== preg_match('/^[A-Za-z0-9._~-]{43,128}$/', $codeVerifier)
            || !hash_equals($entity->getCodeChallenge(), rtrim(strtr(base64_encode(hash('sha256', $codeVerifier, true)), '+/', '-_'), '='))) {
            throw self::invalidGrant('PKCE verification failed');
        }
        if ($this->checkResource($resource) !== $entity->getResource()) {
            throw new OAuthException(OAuthException::INVALID_TARGET, 'resource does not match the authorization request');
        }

        return $this->issueTokens($grant, $now);
    }

    /**
     * Exchanges a refresh token (single use). A rotated token presented again after the grace window revokes
     * the grant.
     *
     * @return array{access_token: string, token_type: string, expires_in: int, refresh_token: string, scope: string}
     *
     * @throws OAuthException
     */
    public function refresh(OAuthClient $client, string $refreshToken, ?string $resource = null): array
    {
        $this->checkResource($resource);
        $now = $this->now();
        $token = '' === $refreshToken ? null : $this->tokens->findOneByHash(self::hash($refreshToken));
        if (null === $token || McpToken::REFRESH !== $token->getType() || $token->getGrant()->getClient()->getId() !== $client->getId()) {
            throw self::invalidGrant('Invalid refresh token');
        }
        $grant = $token->getGrant();
        $this->em->refresh($grant);
        if ($this->grantEnded($grant, $now) || $token->getExpiresAt() <= $now) {
            throw self::invalidGrant('Refresh token expired or revoked');
        }
        $won = 1 === $this->em->getConnection()->executeStatement(
            'UPDATE mcp_token SET rotated_at = ? WHERE id = ? AND rotated_at IS NULL',
            [$this->utc($now), $token->getId()],
        );
        if (!$won) {
            // Lost the race or a replay: look at the committed state.
            $rotatedAt = $this->em->getConnection()->fetchOne('SELECT rotated_at FROM mcp_token WHERE id = ?', [$token->getId()]);
            if (!is_string($rotatedAt)) {
                throw self::invalidGrant('Refresh token expired or revoked');
            }
            $rotated = new \DateTimeImmutable($rotatedAt, new \DateTimeZone('UTC'));
            if ($now->getTimestamp() - $rotated->getTimestamp() > $this->reuseGrace) {
                $this->revokeGrant($grant);
                throw self::invalidGrant('Refresh token reused');
            }
        }

        return $this->issueTokens($grant, $now);
    }

    /**
     * RFC 7009: revokes the grant behind an access or refresh token. Silent for unknown tokens and tokens of
     * other clients.
     */
    public function revokeToken(string $token, ?OAuthClient $client = null): void
    {
        $entity = '' === $token ? null : $this->tokens->findOneByHash(self::hash($token));
        if (null === $entity || (null !== $client && $entity->getGrant()->getClient()->getId() !== $client->getId())) {
            return;
        }
        $this->revokeGrant($entity->getGrant());
    }

    public function revokeGrant(McpGrant $grant): void
    {
        $grant->revoke($this->now());
        $this->em->flush();
    }

    /** Revokes every open grant of the user (sign out everywhere, password change, account deletion). */
    public function revokeAllGrantsOfUser(User|string $user): int
    {
        $userId = $user instanceof User ? $user->getId() : $user;
        $now = $this->now();
        $count = 0;
        foreach ($this->grants->findBy(['user' => $userId]) as $grant) {
            if (null === $grant->getRevokedAt()) {
                $grant->revoke($now);
                ++$count;
            }
        }
        $this->em->flush();

        return $count;
    }

    /** The user, grant and scopes behind a valid access token; null for anything else (unknown, refresh token, expired, revoked grant). */
    public function resolveAccessToken(string $accessToken): ?ResolvedAccessToken
    {
        $token = '' === $accessToken ? null : $this->tokens->findOneByHash(self::hash($accessToken));
        if (null === $token || McpToken::ACCESS !== $token->getType()) {
            return null;
        }
        $now = $this->now();
        $grant = $token->getGrant();
        $this->em->refresh($grant);
        if ($token->getExpiresAt() <= $now || $this->grantEnded($grant, $now)) {
            return null;
        }
        $scopes = McpScope::parse($grant->getScopes());
        if (null === $scopes) {
            return null;
        }
        $last = $grant->getLastUsedAt();
        if (null === $last || $now->getTimestamp() - $last->getTimestamp() >= self::TOUCH_INTERVAL) {
            $this->em->getConnection()->executeStatement('UPDATE mcp_grant SET last_used_at = ? WHERE id = ?', [$this->utc($now), $grant->getId()]);
            $grant->touch($now);
        }

        return new ResolvedAccessToken($grant->getUser(), $grant, $scopes);
    }

    /** @throws OAuthException */
    private function checkResource(?string $resource): string
    {
        $canonical = $this->canonicalResource();
        if (null !== $resource && '' !== $resource && $resource !== $canonical) {
            throw new OAuthException(OAuthException::INVALID_TARGET, 'resource must be '.$canonical);
        }

        return $canonical;
    }

    public function redirectUriRegistered(OAuthClient $client, string $redirectUri): bool
    {
        foreach ($client->getRedirectUris() as $registered) {
            if (hash_equals($registered, $redirectUri)) {
                return true;
            }
            if (self::loopbackEquivalent($registered, $redirectUri)) {
                return true;
            }
        }

        return false;
    }

    /** Loopback http URIs match ignoring the port (RFC 8252 7.3), but only when both are clean. */
    private static function loopbackEquivalent(string $registered, string $requested): bool
    {
        $a = RedirectUriPolicy::parse($registered);
        $b = RedirectUriPolicy::parse($requested);
        if (null === $a || null === $b || !$a['loopback'] || !$b['loopback'] || 'http' !== $a['scheme'] || 'http' !== $b['scheme']) {
            return false;
        }
        if ($a['host'] !== $b['host'] || $a['path'] !== $b['path'] || $a['query'] !== $b['query']) {
            return false;
        }
        $p = parse_url($requested);
        $rebuilt = 'http://'.$b['host'].(isset($p['port']) ? ':'.$p['port'] : '').$b['path'].(null !== $b['query'] ? '?'.$b['query'] : '');

        return $rebuilt === $requested;
    }

    private function grantEnded(McpGrant $grant, \DateTimeImmutable $now): bool
    {
        return null !== $grant->getRevokedAt() || $grant->getExpiresAt() <= $now;
    }

    /** @return array{access_token: string, token_type: string, expires_in: int, refresh_token: string, scope: string} */
    private function issueTokens(McpGrant $grant, \DateTimeImmutable $now): array
    {
        $end = $grant->getExpiresAt();
        $access = $this->randomToken();
        $refresh = $this->randomToken();
        $accessExpires = min($now->modify(sprintf('+%d seconds', $this->accessTtl)), $end);
        $refreshExpires = min($now->modify(sprintf('+%d seconds', $this->refreshLifetime)), $end);
        $this->em->persist(new McpToken($grant, McpToken::ACCESS, self::hash($access), $now, $accessExpires));
        $this->em->persist(new McpToken($grant, McpToken::REFRESH, self::hash($refresh), $now, $refreshExpires));
        $this->em->flush();

        return [
            'access_token' => $access,
            'token_type' => 'Bearer',
            'expires_in' => max(0, $accessExpires->getTimestamp() - $now->getTimestamp()),
            'refresh_token' => $refresh,
            'scope' => $grant->getScopes(),
        ];
    }

    private static function invalidGrant(string $description): OAuthException
    {
        return new OAuthException(OAuthException::INVALID_GRANT, $description);
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private function randomToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function now(): \DateTimeImmutable
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
    }

    private function utc(\DateTimeImmutable $t): string
    {
        return $t->setTimezone(new \DateTimeZone('UTC'))->format(self::FORMAT);
    }
}
