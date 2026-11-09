<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Who may create an account. With RESTRICT_REGISTRATION only addresses with an open club invitation may
 * (password registration and the creation of a NEW user by SSO); sign-in and linking are not affected.
 */
readonly class RegistrationPolicy
{
    public function __construct(
        private ClubInvitationService $invitations,
        private PublicFeedService $publicFeeds,
        #[Autowire(param: 'app.restrict_registration')]
        private bool $restricted,
    ) {
    }

    public function isRestricted(): bool
    {
        return $this->restricted;
    }

    public function mayRegister(string $email, ?FeedProof $proof = null): bool
    {
        return !$this->restricted || $this->invitations->hasOpenInvitationFor($email) || $this->proofAllowsSignup($proof);
    }

    /**
     * A feed proof counts when the feed is joinable with it and its club currently lets new members in through
     * this feed's visibility (the rule of FeedClaimService for a new member). Anything else is just "no proof".
     */
    public function proofAllowsSignup(?FeedProof $proof): bool
    {
        if (null === $proof) {
            return false;
        }
        $feed = $this->publicFeeds->findJoinableFeed($proof->feedId, $proof->secret, $proof->secretSha256);

        return null !== $feed && $feed->getClub()->getFeedSignup()->allows($feed->getVisibility());
    }
}
