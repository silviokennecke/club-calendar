<?php

declare(strict_types=1);

namespace App\Security;

use App\Exception\ApiProblemException;
use App\Repository\RefreshTokenRepository;
use Psr\Clock\ClockInterface;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;

/**
 * Whether the session (refresh-token family, claim `fam`) of the presenting access token is still alive. A
 * leftover access token of a signed-out, reuse-revoked or ended session must neither continue the session under
 * a new family nor obtain or use a step-up token. One indexed query per request and token (cached); a token
 * without `fam` (issued before the claim existed, at most 15 minutes old) has no family to check.
 */
final class SessionFamilyGuard
{
    /** @var \WeakMap<TokenInterface, \DateTimeImmutable|false> */
    private \WeakMap $cache;

    public function __construct(
        private readonly TokenStorageInterface $tokenStorage,
        private readonly RefreshTokenRepository $refreshTokens,
        private readonly ClockInterface $clock,
    ) {
        $this->cache = new \WeakMap();
    }

    /** The family claim of the presenting token, null when it has none. */
    public function family(): ?string
    {
        return SessionConsentListener::family($this->tokenStorage->getToken());
    }

    /**
     * Absolute end of the live session, null for a token without `fam`.
     *
     * @throws ApiProblemException 401 `invalid_token` when the family is not live
     */
    public function liveExpiry(): ?\DateTimeImmutable
    {
        $token = $this->tokenStorage->getToken();
        $family = SessionConsentListener::family($token);
        $user = $token?->getUser();
        if (null === $token || null === $family || !$user instanceof \App\Entity\User) {
            return null;
        }
        $expiry = $this->cache[$token] ??= $this->refreshTokens->findLiveFamilyExpiry($family, $user->getId(), $this->clock->now()) ?? false;
        if (false === $expiry) {
            throw new ApiProblemException(401, 'The session has ended', JwtProblemListener::INVALID_TOKEN_CODE, null, ['WWW-Authenticate' => 'Bearer']);
        }

        return $expiry;
    }
}
