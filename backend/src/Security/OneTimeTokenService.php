<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Opaque, short-lived, single-use tokens that stand for "this user may get a session now" and are redeemed
 * at the token endpoint (`POST /api/auth/token`, `grant_type=one_time_token`).
 *
 * Built on {@see SignedTokenService} (HMAC, key per purpose: a token of one purpose never verifies for
 * another) and {@see NonceStore} (single use, also across processes). The token names the user and the
 * user's session version (`tv`): ending the sessions (password change, takeover revocation) kills pending
 * tokens, and the TTL is the one the token was issued with.
 */
final readonly class OneTimeTokenService
{
    /** Purpose of the code the SSO callback hands to the frontend (instead of the tokens themselves). */
    public const string PURPOSE_OAUTH_LOGIN = 'login.oauth';

    public function __construct(
        private SignedTokenService $signedTokens,
        private NonceStore $nonces,
        private EntityManagerInterface $em,
    ) {
    }

    public function issue(User $user, string $purpose, int $ttlSeconds): string
    {
        return $this->signedTokens->issue($purpose, [
            'n' => SignedTokenService::b64(random_bytes(32)),
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
        ], $ttlSeconds);
    }

    /**
     * The user the token was issued for, or null (malformed, forged, expired, other purpose, used before,
     * user gone, sessions ended since). The token is consumed only by a successful
     * redemption.
     *
     * @param list<string> $purposes purposes accepted by the caller
     */
    public function redeem(string $token, array $purposes): ?User
    {
        foreach ($purposes as $purpose) {
            $claims = $this->signedTokens->verify($purpose, $token);
            if (null === $claims) {
                continue;
            }
            if (!is_string($claims['n'] ?? null) || !is_string($claims['uid'] ?? null) || !is_int($claims['tv'] ?? null)) {
                return null;
            }
            $user = $this->em->getRepository(User::class)->find($claims['uid']);
            if (null === $user || $user->getTokenVersion() !== $claims['tv']) {
                return null;
            }

            return $this->nonces->consume($purpose, $claims['n'], $claims['exp']) ? $user : null;
        }

        return null;
    }
}
