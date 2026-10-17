<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\RefreshToken;
use App\Entity\User;
use App\Repository\RefreshTokenRepository;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Access tokens (JWT bundle) and refresh tokens. A refresh token is an HMAC-signed JWT with `jti` (row of
 * `refresh_token`) and `fam` (the session it belongs to): it slides 7 days per token, but never past the
 * absolute end of its family. Rotation, reuse detection and revocation: {@see AuthService::refresh()}.
 */
class TokenService
{
    private const int REFRESH_TTL = 7 * 24 * 3600; // 7 days, per token

    public function __construct(
        private readonly JWTTokenManagerInterface $jwtManager,
        private readonly string $refreshSecret,
        private readonly RefreshTokenRepository $refreshTokens,
        private readonly ClockInterface $clock,
        /** Seconds a session (token family) lasts at most, however often it is refreshed. */
        #[Autowire(env: 'int:REFRESH_TOKEN_ABSOLUTE_LIFETIME')]
        private readonly int $absoluteLifetime,
    ) {
    }

    public function now(): \DateTimeImmutable
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
    }

    public function createAccessToken(User $user): string
    {
        return $this->jwtManager->createFromPayload($user, $this->sessionClaims($user));
    }

    /**
     * Issues and stores a refresh token: a new session (family), or the next token of `$familyId`, which
     * then ends at `$familyExpiresAt` at the latest.
     */
    public function createRefreshToken(User $user, ?string $familyId = null, ?\DateTimeImmutable $familyExpiresAt = null): string
    {
        $now = $this->now();
        $familyExpiresAt ??= $now->modify('+'.$this->absoluteLifetime.' seconds');
        $expiresAt = min($now->modify('+'.self::REFRESH_TTL.' seconds'), $familyExpiresAt);
        $row = new RefreshToken($user, $familyId, $now, $expiresAt, $familyExpiresAt);
        $this->refreshTokens->store($row);

        $payload = [
            'sub' => $user->getId(),
            'exp' => $expiresAt->getTimestamp(),
            'type' => 'refresh',
            'jti' => $row->getId(),
            'fam' => $row->getFamilyId(),
        ] + $this->sessionClaims($user);
        $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body = base64_encode(json_encode($payload));
        $sig = hash_hmac('sha256', "$header.$body", $this->refreshSecret, true);

        return "$header.$body.".base64_encode($sig);
    }

    /**
     * Verifies signature (and, unless `$allowExpired`, the expiry) of a refresh token.
     *
     * @return array<string, mixed>
     *
     * @throws \InvalidArgumentException
     */
    public function decodeRefreshToken(string $token, bool $allowExpired = false): array
    {
        $parts = explode('.', $token);
        if (3 !== count($parts)) {
            throw new \InvalidArgumentException('Invalid refresh token format');
        }
        [$header, $body, $sig] = $parts;
        $expectedSig = base64_encode(hash_hmac('sha256', "$header.$body", $this->refreshSecret, true));
        if (!hash_equals($expectedSig, $sig)) {
            throw new \InvalidArgumentException('Invalid refresh token signature');
        }
        $payload = json_decode(base64_decode($body), true);
        if (!is_array($payload) || 'refresh' !== ($payload['type'] ?? null) || (!$allowExpired && ($payload['exp'] ?? 0) < $this->clock->now()->getTimestamp())) {
            throw new \InvalidArgumentException('Refresh token expired');
        }

        return $payload;
    }

    /**
     * Whether a token payload (access or refresh) still belongs to the user's current sessions: issued for
     * this account (not a deleted one with the same address) and not before the last invalidation.
     * Tokens issued before the claims existed have neither "uid" nor "tv" and count as version 0.
     *
     * @param array<string, mixed> $payload
     */
    public function isCurrentSession(User $user, array $payload): bool
    {
        if (array_key_exists('uid', $payload) && $payload['uid'] !== $user->getId()) {
            return false;
        }
        $version = $payload['tv'] ?? 0;

        return is_int($version) && $version === $user->getTokenVersion();
    }

    /** @return array{uid: string, tv: int} */
    private function sessionClaims(User $user): array
    {
        return ['uid' => $user->getId(), 'tv' => $user->getTokenVersion()];
    }

    /** Revokes every refresh token (session) of the user. */
    public function revokeAllRefreshTokens(User $user): void
    {
        $this->refreshTokens->revokeAllOfUser($user->getId(), $this->now());
    }

    /**
     * Token response for a login / grant. `$familyId` + `$familyExpiresAt` continue an existing session
     * (rotation); without them a new session starts.
     */
    public function tokenResponse(User $user, ?string $familyId = null, ?\DateTimeImmutable $familyExpiresAt = null): array
    {
        return [
            'access_token' => $this->createAccessToken($user),
            'token_type' => 'Bearer',
            'expires_in' => 900,
            'refresh_token' => $this->createRefreshToken($user, $familyId, $familyExpiresAt),
            'user' => [
                'id' => $user->getId(),
                'name' => $user->getName(),
                'email' => $user->getEmail(),
                'dateFormat' => $user->getDateFormat(),
                'firstDayOfWeek' => $user->getFirstDayOfWeek(),
                'lastClubId' => $user->getLastClubId(),
                'lastCalendarId' => $user->getLastCalendarId(),
                'language' => $user->getLanguage(),
            ],
        ];
    }
}
