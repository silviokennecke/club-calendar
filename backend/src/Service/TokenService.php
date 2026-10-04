<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;

class TokenService
{
    private const int REFRESH_TTL = 7 * 24 * 3600; // 7 days

    public function __construct(
        private readonly JWTTokenManagerInterface $jwtManager,
        private readonly string $refreshSecret,
    ) {
    }

    public function createAccessToken(User $user): string
    {
        return $this->jwtManager->createFromPayload($user, $this->sessionClaims($user));
    }

    public function createRefreshToken(User $user): string
    {
        $payload = [
            'sub' => $user->getId(),
            'exp' => time() + self::REFRESH_TTL,
            'type' => 'refresh',
        ] + $this->sessionClaims($user);
        $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body = base64_encode(json_encode($payload));
        $sig = hash_hmac('sha256', "$header.$body", $this->refreshSecret, true);

        return "$header.$body.".base64_encode($sig);
    }

    public function decodeRefreshToken(string $token): array
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
        if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) {
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

    public function tokenResponse(User $user): array
    {
        return [
            'access_token' => $this->createAccessToken($user),
            'token_type' => 'Bearer',
            'expires_in' => 900,
            'refresh_token' => $this->createRefreshToken($user),
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
