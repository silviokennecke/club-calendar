<?php

declare(strict_types=1);

namespace App\Security\StepUp;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\SessionFamilyGuard;
use App\Security\SignedTokenService;
use Symfony\Component\Uid\Uuid;

/**
 * The step-up token: a signed token (purpose `step_up`) that proves a sensitive-action confirmation (password
 * or mailed code, plus an MFA factor when MFA is on; the claim `mfa` records whether a factor was required) for ONE session. Valid TTL seconds, never renewed or extended
 * (a new one needs a new confirmation). Bound to the user, the token version (`tv`, so a version bump kills it)
 * and the refresh-token family (`fam`) of the access token it was issued for, so it is useless in another session and
 * dies with that session (a dead family is a 401 for the access token, see {@see SessionFamilyGuard}).
 * Carried in the `X-Step-Up-Token` header next to the normal access token.
 */
class StepUpTokenService
{
    public const string PURPOSE = 'step_up';
    public const int TTL = 600;
    public const string HEADER = 'X-Step-Up-Token';

    public function __construct(
        private readonly SignedTokenService $signedTokens,
        private readonly SessionFamilyGuard $familyGuard,
    ) {
    }

    /** Whether the presenting session can get and use a step-up at all (its access token carries the `fam` claim). */
    public function sessionFamily(): ?string
    {
        return $this->familyGuard->family();
    }

    /**
     * @throws ApiProblemException 403 `step_up_unavailable`: the access token has no session claim (issued before it
     *                             existed, at most 15 minutes old); the client refreshes the access token first;
     *                             401 `invalid_token`: its session was signed out, revoked or has ended
     */
    public function requireFamily(): string
    {
        $this->familyGuard->liveExpiry();

        return $this->sessionFamily() ?? throw new ApiProblemException(403, 'Refresh the access token first', 'step_up_unavailable');
    }

    /** @return array{token: string, expiresIn: int} */
    public function issue(User $user, bool $mfa): array
    {
        return ['token' => $this->signedTokens->issue(self::PURPOSE, [
            'sub' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'fam' => $this->requireFamily(),
            'mfa' => $mfa,
            'jti' => Uuid::v7()->toRfc4122(),
        ], self::TTL), 'expiresIn' => self::TTL];
    }

    public function accepts(?string $token, User $user): bool
    {
        $family = $this->sessionFamily();
        $this->familyGuard->liveExpiry();
        if (null === $family || null === $token || '' === $token) {
            return false;
        }
        $claims = $this->signedTokens->verify(self::PURPOSE, $token);

        return null !== $claims
            && ($claims['sub'] ?? null) === $user->getId()
            && ($claims['tv'] ?? null) === $user->getTokenVersion()
            && ($claims['fam'] ?? null) === $family
            // a token proven without a factor stops counting once MFA was turned on afterwards
            && (true === ($claims['mfa'] ?? null) || !$user->isMfaEnforced());
    }
}
