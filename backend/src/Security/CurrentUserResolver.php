<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Repository\RefreshTokenRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\SecurityBundle\Security;

readonly class CurrentUserResolver
{
    public function __construct(
        private readonly Security $security,
        private readonly EntityManagerInterface $em,
        private readonly RefreshTokenRepository $refreshTokens,
    ) {
    }

    /** Consent flag (`lc` claim) of the presenting access token: the session started with all current consents given. */
    public function sessionConsentOk(): bool
    {
        return SessionConsentListener::isOk($this->security->getToken());
    }

    /**
     * Absolute end of the presenting session (its refresh-token family), to be handed to
     * `TokenService::tokenResponse` when the session continues under a new family. Null (a token from before the
     * claim existed, at most 15 minutes old) lets the new family start with the full lifetime.
     */
    public function sessionFamilyExpiresAt(): ?\DateTimeImmutable
    {
        $family = SessionConsentListener::family($this->security->getToken());
        $user = $this->security->getUser();
        if (null === $family || null === $user) {
            return null;
        }
        $row = $this->em->getRepository(User::class)->findOneBy(['email' => $user->getUserIdentifier()]);

        return null === $row ? null : $this->refreshTokens->findFamilyExpiry($family, $row->getId());
    }

    public function resolve(): User
    {
        $securityUser = $this->security->getUser();
        if (null === $securityUser) {
            throw new ApiProblemException(401, 'Not authenticated', JwtProblemListener::MISSING_TOKEN_CODE, null, ['WWW-Authenticate' => 'Bearer']);
        }

        // Reload from DB to get a managed entity
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $securityUser->getUserIdentifier()]);
        if (null === $user) {
            throw new ApiProblemException(401, 'User not found', JwtProblemListener::INVALID_TOKEN_CODE, null, ['WWW-Authenticate' => 'Bearer']);
        }

        return $user;
    }
}
