<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\FeedMember;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Which feeds a user may include in their personal account: club members only; PUBLIC and CLUB feeds for all of
 * them, PRIVATE feeds for staff (viewer or above) and for members with a FeedMember row (assigned or claimed).
 */
readonly class FeedAccessPolicy
{
    public function __construct(private EntityManagerInterface $em)
    {
    }

    public function role(User $user, Club $club): ?ClubRole
    {
        return $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user])?->getRole();
    }

    public function canAccess(User $user, CalendarFeed $feed): bool
    {
        $role = $this->role($user, $feed->getClub());
        if (null === $role) {
            return false;
        }
        if (FeedVisibility::PRIVATE !== $feed->getVisibility() || $role->isStaff()) {
            return true;
        }

        return $this->hasFeedMember($user, $feed);
    }

    public function hasFeedMember(User $user, CalendarFeed $feed): bool
    {
        return null !== $this->em->getRepository(FeedMember::class)->findOneBy(['feed' => $feed, 'user' => $user]);
    }

    /**
     * All feeds of the club the user may include (at most three queries, however many feeds there are).
     *
     * @return list<CalendarFeed>
     */
    public function accessibleFeeds(User $user, Club $club): array
    {
        $role = $this->role($user, $club);
        if (null === $role) {
            return [];
        }
        /** @var list<CalendarFeed> $feeds */
        $feeds = $this->em->getRepository(CalendarFeed::class)->findBy(['club' => $club], ['name' => 'ASC', 'id' => 'ASC']);
        if ($role->isStaff()) {
            return $feeds;
        }
        $assigned = array_flip(array_map('current', $this->em->createQueryBuilder()
            ->select('IDENTITY(m.feed)')
            ->from(FeedMember::class, 'm')
            ->join('m.feed', 'f')
            ->where('m.user = :user AND f.club = :club')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->getQuery()
            ->getScalarResult()));

        return array_values(array_filter(
            $feeds,
            fn (CalendarFeed $f) => FeedVisibility::PRIVATE !== $f->getVisibility() || isset($assigned[$f->getId()]),
        ));
    }
}
