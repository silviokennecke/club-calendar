<?php

declare(strict_types=1);

namespace App\Security\StepUp;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\SessionConsentListener;
use App\Security\SignedTokenService;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;
use Symfony\Component\Uid\Uuid;

/**
 * The step-up token: a signed token (purpose `step_up`) that proves a sensitive-action confirmation (password
 * or mailed code, plus an MFA factor when MFA is on) for ONE session. Valid TTL seconds, never renewed or extended
 * (a new one needs a new confirmation). Bound to the user, the token version (`tv`, so any session ending kills it)
 * and the refresh-token family (`fam`) of the access token it was issued for, so it is useless in another session.
 * Carried in the `X-Step-Up-Token` header next to the normal access token.
 */
class StepUpTokenService
{
    public const string PURPOSE = 'step_up';
    public const int TTL = 600;
    public const string HEADER = 'X-Step-Up-Token';

    public function __construct(
        private readonly SignedTokenService $signedTokens,
        private readonly TokenStorageInterface $tokenStorage,
    ) {
    }

    /** Whether the presenting session can get and use a step-up at all (its access token carries the `fam` claim). */
    public function sessionFamily(): ?string
    {
        return SessionConsentListener::family($this->tokenStorage->getToken());
    }

    /**
     * @throws ApiProblemException 403 `step_up_unavailable`: the access token has no session claim (issued before it
     *                             existed, at most 15 minutes old); the client refreshes the access token first
     */
    public function requireFamily(): string
    {
        return $this->sessionFamily() ?? throw new ApiProblemException(403, 'Refresh the access token first', 'step_up_unavailable');
    }

    /** @return array{token: string, expiresIn: int} */
    public function issue(User $user): array
    {
        return ['token' => $this->signedTokens->issue(self::PURPOSE, [
            'sub' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'fam' => $this->requireFamily(),
            'jti' => Uuid::v7()->toRfc4122(),
        ], self::TTL), 'expiresIn' => self::TTL];
    }

    public function accepts(?string $token, User $user): bool
    {
        $family = $this->sessionFamily();
        if (null === $family || null === $token || '' === $token) {
            return false;
        }
        $claims = $this->signedTokens->verify(self::PURPOSE, $token);

        return null !== $claims
            && ($claims['sub'] ?? null) === $user->getId()
            && ($claims['tv'] ?? null) === $user->getTokenVersion()
            && ($claims['fam'] ?? null) === $family;
    }
}
