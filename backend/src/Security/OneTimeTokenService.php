<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Opaque, short-lived, single-use tokens that stand for "this user may get a session now" and are redeemed
 * at the token endpoint (`POST /api/auth/token`, `grant_type=one_time_token`).
 *
 * Built on {@see SignedTokenService} (HMAC, key per purpose: a token of one purpose never verifies for
 * another) and {@see NonceStore} (single use, also across processes). The token names the user and the
 * user's session version (`tv`): ending the sessions (password change, takeover revocation) kills pending
 * tokens, and the TTL is the one the token was issued with.
 *
 * A token issued with a challenge (`cc`, PKCE S256) is redeemed only with the matching verifier, which binds
 * the SSO login code to the browser that started the flow (login CSRF).
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

    /** @param string|null $challenge S256 challenge (base64url) the redeemer must prove with the verifier */
    public function issue(User $user, string $purpose, int $ttlSeconds, ?string $challenge = null): string
    {
        return $this->signedTokens->issue($purpose, [
            'n' => SignedTokenService::b64(random_bytes(32)),
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
        ] + (null === $challenge ? [] : ['cc' => $challenge]), $ttlSeconds);
    }

    /** Challenge a start request must send: S256 of a 32-byte verifier, base64url without padding. */
    public static function isWellFormedChallenge(mixed $challenge): bool
    {
        return is_string($challenge) && 1 === preg_match('/^[A-Za-z0-9_-]{43}$/', $challenge);
    }

    public static function challengeFor(string $verifier): string
    {
        return SignedTokenService::b64(hash('sha256', $verifier, true));
    }

    /**
     * The user the token was issued for, or null (malformed, forged, expired, other purpose, used before,
     * user gone, sessions ended since). The token is consumed only by a successful
     * redemption.
     *
     * @param list<string> $purposes purposes accepted by the caller
     *
     * @throws ApiProblemException 400 invalid_code_verifier: the token requires a verifier that is missing or
     *                             wrong. The token is consumed first, so a wrong guess burns it (the user signs in again).
     */
    public function redeem(string $token, array $purposes, ?string $verifier = null): ?User
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

            // The SSO code always needs a challenge; a code without one never redeems.
            $challenge = $claims['cc'] ?? null;
            if (self::PURPOSE_OAUTH_LOGIN === $purpose && !self::isWellFormedChallenge($challenge)) {
                return null;
            }
            if (!$this->nonces->consume($purpose, $claims['n'], $claims['exp'])) {
                return null;
            }
            if (null !== $challenge && (!is_string($verifier) || !hash_equals((string) $challenge, self::challengeFor($verifier)))) {
                throw new ApiProblemException(400, 'The sign-in was not started in this browser', 'invalid_code_verifier');
            }

            return $user;
        }

        return null;
    }
}
