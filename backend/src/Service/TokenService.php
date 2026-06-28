<?php
declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use InvalidArgumentException;
use Lexik\Bundle\JWTAuthenticationBundle\Services\JWTTokenManagerInterface;

class TokenService
{
    private const int REFRESH_TTL = 7 * 24 * 3600; // 7 days

    public function __construct(
        private readonly JWTTokenManagerInterface $jwtManager,
        private readonly string $refreshSecret,
    ) {}

    public function createAccessToken(User $user): string
    {
        return $this->jwtManager->create($user);
    }

    public function createRefreshToken(User $user): string
    {
        $payload = [
            'sub'  => $user->getId(),
            'exp'  => time() + self::REFRESH_TTL,
            'type' => 'refresh',
        ];
        $header = base64_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body   = base64_encode(json_encode($payload));
        $sig    = hash_hmac('sha256', "$header.$body", $this->refreshSecret, true);
        return "$header.$body." . base64_encode($sig);
    }

    public function decodeRefreshToken(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidArgumentException('Invalid refresh token format');
        }
        [$header, $body, $sig] = $parts;
        $expectedSig = base64_encode(hash_hmac('sha256', "$header.$body", $this->refreshSecret, true));
        if (!hash_equals($expectedSig, $sig)) {
            throw new InvalidArgumentException('Invalid refresh token signature');
        }
        $payload = json_decode(base64_decode($body), true);
        if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) {
            throw new InvalidArgumentException('Refresh token expired');
        }
        return $payload;
    }

    public function tokenResponse(User $user): array
    {
        return [
            'access_token'  => $this->createAccessToken($user),
            'token_type'    => 'Bearer',
            'expires_in'    => 900,
            'refresh_token' => $this->createRefreshToken($user),
            'user'          => [
                'id'             => $user->getId(),
                'name'           => $user->getName(),
                'email'          => $user->getEmail(),
                'dateFormat'     => $user->getDateFormat(),
                'firstDayOfWeek' => $user->getFirstDayOfWeek(),
                'lastClubId'     => $user->getLastClubId(),
                'lastCalendarId' => $user->getLastCalendarId(),
                'language'       => $user->getLanguage(),
            ],
        ];
    }
}
