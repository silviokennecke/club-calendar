<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedCalendar;
use App\Entity\Club;
use App\Entity\FeedMember;
use App\Entity\MemberSubscription;
use App\Entity\MemberSubscriptionFeed;
use App\Entity\MemberSubscriptionTargetGroup;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Enum\FeedVisibility;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * The personal club subscription ("Mein Abo"): one per (user, club), created lazily and race-safely (INSERT IGNORE
 * on the unique key), edited under a row lock. Selected feeds the user can no longer access (or whose calendars
 * are all archived) are ignored when reading and dropped by the next replace.
 */
readonly class MemberSubscriptionService
{
    public function __construct(
        private EntityManagerInterface $em,
        private FeedAccessPolicy $policy,
        private CalendarReferences $references,
    ) {
    }

    /** @return array{id: string, secret: string, selectedFeedIds: list<string>, targetGroupIds: list<string>, updatedAt: string} */
    public function get(User $user, Club $club): array
    {
        return $this->em->wrapInTransaction(function () use ($user, $club): array {
            [$sub] = $this->ensure($user, $club);

            return $this->serialize($sub, $this->selectable($user, $club)['feeds']);
        });
    }

    /**
     * Replace semantics. `feedIds` must be accessible to the user now (422 `unknown_reference`), `targetGroupIds`
     * must belong to the club.
     *
     * @return array{id: string, secret: string, selectedFeedIds: list<string>, targetGroupIds: list<string>, updatedAt: string}
     */
    public function replace(User $user, Club $club, array $data): array
    {
        foreach (['feedIds', 'targetGroupIds'] as $key) {
            if (!array_key_exists($key, $data)) {
                throw Input::invalid($key, sprintf('%s is required', $key));
            }
        }
        $feedIds = Input::idList($data, 'feedIds');
        $groupIds = Input::idList($data, 'targetGroupIds');

        return $this->em->wrapInTransaction(function () use ($user, $club, $feedIds, $groupIds): array {
            [$sub] = $this->ensure($user, $club);
            $feeds = $this->selectable($user, $club)['feeds'];
            $wanted = [];
            foreach ($feedIds as $id) {
                if (!isset($feeds[$id])) {
                    throw CalendarReferences::unknown('feedIds', $id, $club);
                }
                $wanted[$id] = $feeds[$id];
            }
            $groups = $this->references->findAll(TargetGroup::class, $club, $groupIds, 'targetGroupIds');

            LinkCollectionSync::sync(
                $this->em,
                $sub->getFeeds(),
                array_keys($wanted),
                fn (MemberSubscriptionFeed $l) => $l->getFeed()->getId(),
                fn (string $id) => new MemberSubscriptionFeed($sub, $wanted[$id]),
            );
            LinkCollectionSync::sync(
                $this->em,
                $sub->getTargetGroups(),
                array_keys($groups),
                fn (MemberSubscriptionTargetGroup $l) => $l->getTargetGroup()->getId(),
                fn (string $id) => new MemberSubscriptionTargetGroup($sub, $groups[$id]),
            );
            $this->em->flush();

            return $this->serialize($sub, $feeds);
        });
    }

    /** @return array{id: string, secret: string, selectedFeedIds: list<string>, targetGroupIds: list<string>, updatedAt: string} */
    public function rotateSecret(User $user, Club $club): array
    {
        return $this->em->wrapInTransaction(function () use ($user, $club): array {
            [$sub] = $this->ensure($user, $club);
            $sub->rotateSecret();
            $this->em->flush();

            return $this->serialize($sub, $this->selectable($user, $club)['feeds']);
        });
    }

    /**
     * The feeds the user may select (accessible and with an active calendar) and the club's target groups.
     *
     * @return array{feeds: list<array<string, mixed>>, targetGroups: list<array{id: string, name: string}>}
     */
    public function options(User $user, Club $club): array
    {
        $sub = $this->em->getRepository(MemberSubscription::class)->findOneBy(['club' => $club, 'user' => $user]);
        $selectable = $this->selectable($user, $club);
        $selected = null === $sub ? [] : array_flip($this->selectedFeedIds($sub, $selectable['feeds']));
        $staff = $this->policy->role($user, $club)?->isStaff() ?? false;
        $sources = $staff ? [] : $this->feedSources($user, $club);

        $feeds = [];
        foreach ($selectable['feeds'] as $feed) {
            $feeds[] = [
                'id' => $feed->getId(),
                'name' => $feed->getName(),
                'visibility' => $feed->getVisibility()->value,
                'calendarNames' => $selectable['names'][$feed->getId()],
                'accessReason' => match (true) {
                    FeedVisibility::PUBLIC === $feed->getVisibility() => 'public',
                    FeedVisibility::CLUB === $feed->getVisibility() => 'club',
                    $staff => 'staff',
                    default => $sources[$feed->getId()] ?? 'assigned',
                },
                'selected' => isset($selected[$feed->getId()]),
            ];
        }
        $groups = $this->em->createQueryBuilder()
            ->select('t.id', 't.name')
            ->from(TargetGroup::class, 't')
            ->where('t.club = :club')
            ->orderBy('t.name', 'ASC')->addOrderBy('t.id', 'ASC')
            ->setParameter('club', $club)
            ->getQuery()->getArrayResult();

        return ['feeds' => $feeds, 'targetGroups' => array_map(fn (array $g) => ['id' => $g['id'], 'name' => $g['name']], $groups)];
    }

    /**
     * A feed was claimed (called inside the claim transaction): a new subscription starts with that feed and all
     * groups, an existing one gets the feed added.
     */
    public function addClaimedFeed(User $user, Club $club, CalendarFeed $feed): void
    {
        [$sub] = $this->ensure($user, $club);
        foreach ($sub->getFeeds() as $link) {
            if ($link->getFeed()->getId() === $feed->getId()) {
                return;
            }
        }
        $link = new MemberSubscriptionFeed($sub, $feed);
        $this->em->persist($link);
        $sub->getFeeds()->add($link);
    }

    /** A person who leaves or is removed from the club loses the personal subscription of that club. */
    public function removeAllOfUserInClub(Club $club, User $user): void
    {
        $this->em->createQuery('DELETE FROM '.MemberSubscription::class.' s WHERE s.user = :user AND s.club = :club')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->execute();
    }

    /**
     * The subscription row, created if missing, and locked until the end of the surrounding transaction.
     *
     * @return array{0: MemberSubscription, 1: bool} subscription and whether this call created it
     */
    private function ensure(User $user, Club $club): array
    {
        $conn = $this->em->getConnection();
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        $created = 1 === $conn->executeStatement(
            'INSERT IGNORE INTO member_subscription (id, club_id, user_id, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [Uuid::v7()->toRfc4122(), $club->getId(), $user->getId(), MemberSubscription::newSecret(), $now, $now],
        );
        // FOR UPDATE reads the latest committed row even if a concurrent insert won the race
        $id = $conn->fetchOne('SELECT id FROM member_subscription WHERE club_id = ? AND user_id = ? FOR UPDATE', [$club->getId(), $user->getId()]);
        $sub = $this->em->find(MemberSubscription::class, $id);
        $this->em->refresh($sub);

        return [$sub, $created];
    }

    /**
     * @return array{feeds: array<string, CalendarFeed>, names: array<string, list<string>>} by feed id, in name order
     */
    private function selectable(User $user, Club $club): array
    {
        $rows = $this->em->createQueryBuilder()
            ->select('IDENTITY(fc.feed) AS feedId', 'c.name AS name')
            ->from(CalendarFeedCalendar::class, 'fc')
            ->join('fc.calendar', 'c')
            ->join('fc.feed', 'f')
            ->where('f.club = :club AND c.archivedAt IS NULL')
            ->orderBy('c.name', 'ASC')->addOrderBy('c.id', 'ASC')
            ->setParameter('club', $club)
            ->getQuery()->getArrayResult();
        $names = [];
        foreach ($rows as $row) {
            $names[$row['feedId']][] = $row['name'];
        }
        $feeds = [];
        foreach ($this->policy->accessibleFeeds($user, $club) as $feed) {
            if (isset($names[$feed->getId()])) {
                $feeds[$feed->getId()] = $feed;
            }
        }

        return ['feeds' => $feeds, 'names' => $names];
    }

    /**
     * @param array<string, CalendarFeed> $selectable
     *
     * @return list<string>
     */
    private function selectedFeedIds(MemberSubscription $sub, array $selectable): array
    {
        $ids = [];
        foreach ($sub->getFeeds() as $link) {
            if (isset($selectable[$link->getFeed()->getId()])) {
                $ids[] = $link->getFeed()->getId();
            }
        }
        sort($ids);

        return $ids;
    }

    /** @return array<string, string> feed id => assigned|claimed */
    private function feedSources(User $user, Club $club): array
    {
        $rows = $this->em->createQueryBuilder()
            ->select('IDENTITY(m.feed) AS feedId', 'm.source AS source')
            ->from(FeedMember::class, 'm')
            ->join('m.feed', 'f')
            ->where('m.user = :user AND f.club = :club')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->getQuery()->getArrayResult();

        return array_column($rows, 'source', 'feedId');
    }

    /**
     * @param array<string, CalendarFeed> $selectable
     *
     * @return array{id: string, secret: string, selectedFeedIds: list<string>, targetGroupIds: list<string>, updatedAt: string}
     */
    private function serialize(MemberSubscription $sub, array $selectable): array
    {
        $groups = $sub->getTargetGroups()->map(fn (MemberSubscriptionTargetGroup $l) => $l->getTargetGroup()->getId())->getValues();
        sort($groups);

        return [
            'id' => $sub->getId(),
            'secret' => $sub->getSecret(),
            'selectedFeedIds' => $this->selectedFeedIds($sub, $selectable),
            'targetGroupIds' => $groups,
            'updatedAt' => $sub->getUpdatedAt()->format(\DATE_ATOM),
        ];
    }
}
