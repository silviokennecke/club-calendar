<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\ClubUser;
use App\Entity\FeedMember;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Self-join through a feed: a signed-in user who holds the feed address (and the secret of a PRIVATE feed) becomes
 * a club member (role `member`) if the club setting `feed_signup` allows this feed's visibility, and gets access
 * to a PRIVATE feed. Every failure to identify the feed is the same 404 `feed_not_found`.
 */
readonly class FeedClaimService
{
    public const string NOT_FOUND_CODE = 'feed_not_found';
    public const string SIGNUP_DISABLED_CODE = 'member_signup_disabled';

    public function __construct(
        private EntityManagerInterface $em,
        private PublicFeedService $publicFeeds,
        private FeedAccessPolicy $policy,
        private Quota $quota,
        private MemberSubscriptionService $subscriptions,
    ) {
    }

    /**
     * What the page of a feed offers the signed-in user. `canJoin`: not yet a member and the club allows joining
     * through this feed; `canClaim`: a member without access to this PRIVATE feed (reachable only with its secret).
     *
     * @return array{clubId: string|null, clubName: string, isClubMember: bool, hasFeedAccess: bool, canJoin: bool, canClaim: bool}
     */
    public function membership(User $user, string $feedId, ?string $secret): array
    {
        $feed = $this->resolve($feedId, $secret);
        $club = $feed->getClub();
        $isMember = null !== $this->policy->role($user, $club);
        $hasAccess = $isMember && $this->policy->canAccess($user, $feed);

        return [
            'clubId' => $isMember ? $club->getId() : null,
            'clubName' => $club->getName(),
            'isClubMember' => $isMember,
            'hasFeedAccess' => $hasAccess,
            'canJoin' => !$isMember && $club->getFeedSignup()->allows($feed->getVisibility()),
            'canClaim' => $isMember && !$hasAccess,
        ];
    }

    /**
     * @return array{clubId: string, clubName: string, feedId: string, joined: bool}
     */
    public function claim(User $user, string $feedId, ?string $secret): array
    {
        $feed = $this->resolve($feedId, $secret);
        $club = $feed->getClub();

        $joined = $this->em->wrapInTransaction(function () use ($user, $feed, $club): bool {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $this->em->refresh($club);
            $joined = false;
            $cu = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user]);
            if (null === $cu) {
                if (!$club->getFeedSignup()->allows($feed->getVisibility())) {
                    throw new ApiProblemException(403, 'This club does not accept new members through this feed', self::SIGNUP_DISABLED_CODE);
                }
                $this->quota->assertRoom(Quota::MEMBERS_PER_CLUB, $club);
                $this->quota->assertRoom(Quota::CLUBS_PER_USER, $user);
                $cu = (new ClubUser())->setClub($club)->setUser($user)->setRole(ClubRole::MEMBER);
                $this->em->persist($cu);
                $joined = true;
            }
            if (FeedVisibility::PRIVATE === $feed->getVisibility() && !$cu->getRole()->isStaff()
                && !$this->policy->hasFeedMember($user, $feed)) {
                $this->quota->assertRoom(Quota::FEED_MEMBERS_PER_FEED, $feed);
                $this->em->persist(new FeedMember($feed, $user, FeedMember::CLAIMED, $user));
            }
            $this->em->flush();
            $this->subscriptions->addClaimedFeed($user, $club, $feed);
            $this->em->flush();

            return $joined;
        });

        return ['clubId' => $club->getId(), 'clubName' => $club->getName(), 'feedId' => $feed->getId(), 'joined' => $joined];
    }

    private function resolve(string $feedId, ?string $secret): CalendarFeed
    {
        return $this->publicFeeds->findJoinableFeed($feedId, $secret)
            ?? throw new ApiProblemException(404, 'Feed not found', self::NOT_FOUND_CODE);
    }
}
