<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\FeedMember;
use App\Entity\User;
use App\Enum\FeedVisibility;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/** Staff-managed access of club members to a PRIVATE feed. */
readonly class FeedMemberService
{
    public const int MAX_PER_PAGE = 100;
    public const int DEFAULT_PER_PAGE = 10;

    public function __construct(
        private EntityManagerInterface $em,
        private Quota $quota,
    ) {
    }

    /**
     * @return array{items: list<array{userId: string, name: string, email: string, source: string, createdAt: string}>, total: int}
     */
    public function list(Club $club, string $feedId, int $page, int $perPage, ?string $search, ?string $source): array
    {
        $feed = $this->find($club, $feedId);
        $qb = $this->em->createQueryBuilder()
            ->from(FeedMember::class, 'm')
            ->join('m.user', 'u')
            ->where('m.feed = :feed')
            ->setParameter('feed', $feed);
        if (null !== $source) {
            $qb->andWhere('m.source = :source')->setParameter('source', $source);
        }
        if (null !== $search && '' !== $search) {
            $qb->andWhere('(LOWER(u.name) LIKE :q OR LOWER(u.email) LIKE :q)')
                ->setParameter('q', '%'.addcslashes(mb_strtolower($search), '%_\\').'%');
        }
        $total = (int) (clone $qb)->select('COUNT(m.id)')->getQuery()->getSingleScalarResult();
        $rows = $qb->select('u.id AS userId', 'u.name AS name', 'u.email AS email', 'm.source AS source', 'm.createdAt AS createdAt')
            ->orderBy('u.name', 'ASC')
            ->addOrderBy('u.id', 'ASC')
            ->setFirstResult(($page - 1) * $perPage)
            ->setMaxResults($perPage)
            ->getQuery()
            ->getArrayResult();

        return [
            'items' => array_map(static fn (array $r) => [
                'userId' => $r['userId'],
                'name' => $r['name'],
                'email' => $r['email'],
                'source' => $r['source'],
                'createdAt' => $r['createdAt']->format(\DATE_ATOM),
            ], $rows),
            'total' => $total,
        ];
    }

    /**
     * Gives club members access (source `assigned`; a `claimed` row is upgraded). Every id must belong to a member
     * of the club (422 `unknown_reference`). Returns how many people newly got or upgraded to assigned access.
     *
     * @param list<string> $userIds
     */
    public function assign(Club $club, string $feedId, array $userIds, User $actor): int
    {
        $this->assertPrivate($club, $feedId);

        return $this->em->wrapInTransaction(function () use ($club, $feedId, $userIds, $actor): int {
            $feed = $this->lockedFeed($club, $feedId);
            $users = [];
            if ([] !== $userIds) {
                $rows = $this->em->createQueryBuilder()
                    ->select('cu', 'u')
                    ->from(ClubUser::class, 'cu')
                    ->join('cu.user', 'u')
                    ->where('cu.club = :club AND u.id IN (:ids)')
                    ->setParameter('club', $club)
                    ->setParameter('ids', $userIds)
                    ->getQuery()
                    ->getResult();
                foreach ($rows as $cu) {
                    $users[$cu->getUser()->getId()] = $cu->getUser();
                }
            }
            foreach ($userIds as $id) {
                if (!isset($users[$id])) {
                    throw CalendarReferences::unknown('userIds', $id, $club);
                }
            }

            return $this->addAssigned($feed, array_values($users), $actor);
        });
    }

    /**
     * Same by e-mail address. Addresses of people who are no member of the club are returned in `unknown` (and
     * ignored); this tells staff nothing they cannot see in the member list.
     *
     * @param list<string> $emails
     *
     * @return array{added: int, unknown: list<string>}
     */
    public function assignByEmail(Club $club, string $feedId, array $emails, User $actor): array
    {
        $this->assertPrivate($club, $feedId);

        return $this->em->wrapInTransaction(function () use ($club, $feedId, $emails, $actor): array {
            $feed = $this->lockedFeed($club, $feedId);
            $normalized = array_values(array_unique(array_map(EmailAddress::normalize(...), $emails)));
            $found = [];
            if ([] !== $normalized) {
                $rows = $this->em->createQueryBuilder()
                    ->select('cu', 'u')
                    ->from(ClubUser::class, 'cu')
                    ->join('cu.user', 'u')
                    ->where('cu.club = :club AND u.email IN (:emails)')
                    ->setParameter('club', $club)
                    ->setParameter('emails', $normalized)
                    ->getQuery()
                    ->getResult();
                foreach ($rows as $cu) {
                    // the column collation may equate look-alikes: only an exact match counts
                    $found[$cu->getUser()->getEmail()] = $cu->getUser();
                }
            }
            $unknown = array_values(array_filter($normalized, fn (string $e) => !isset($found[$e])));
            $users = array_values(array_intersect_key($found, array_flip($normalized)));

            return ['added' => $this->addAssigned($feed, $users, $actor), 'unknown' => $unknown];
        });
    }

    public function remove(Club $club, string $feedId, string $userId): void
    {
        $this->removeMany($club, $feedId, [$userId]);
    }

    /**
     * Removes access of the given users (ids that have none are ignored). Staff keep reading PRIVATE feeds through
     * their role.
     *
     * @param list<string> $userIds
     */
    public function removeMany(Club $club, string $feedId, array $userIds): int
    {
        $feed = $this->find($club, $feedId);
        if ([] === $userIds) {
            return 0;
        }
        $removed = (int) $this->em->createQuery('DELETE FROM '.FeedMember::class.' m WHERE m.feed = :feed AND IDENTITY(m.user) IN (:ids)')
            ->setParameter('feed', $feed)
            ->setParameter('ids', $userIds)
            ->execute();
        if ($removed > 0) {
            // bulk DQL bypasses the unit of work: stamp the feed like an association change does
            $feed->stampUpdate(new \DateTimeImmutable(), null);
            $this->em->flush();
        }

        return $removed;
    }

    /** A person who leaves or is removed from the club loses the access to the club's feeds. */
    public function removeAllOfUserInClub(Club $club, User $user): void
    {
        $this->em->createQuery('DELETE FROM '.FeedMember::class.' m WHERE m.user = :user AND m.feed IN (SELECT f.id FROM '.CalendarFeed::class.' f WHERE f.club = :club)')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->execute();
    }

    /** @param list<User> $users */
    private function addAssigned(CalendarFeed $feed, array $users, User $actor): int
    {
        if ([] === $users) {
            return 0;
        }
        $existing = [];
        /** @var list<FeedMember> $rows */
        $rows = $this->em->getRepository(FeedMember::class)->findBy(['feed' => $feed, 'user' => $users]);
        foreach ($rows as $row) {
            $existing[$row->getUser()->getId()] = $row;
        }
        $new = array_filter($users, fn (User $u) => !isset($existing[$u->getId()]));
        $this->quota->assertRoom(Quota::FEED_MEMBERS_PER_FEED, $feed, count($new));
        $changed = 0;
        foreach ($users as $user) {
            $row = $existing[$user->getId()] ?? null;
            if (null === $row) {
                $this->em->persist(new FeedMember($feed, $user, FeedMember::ASSIGNED, $actor));
                ++$changed;
            } elseif (FeedMember::CLAIMED === $row->getSource()) {
                $row->setSource(FeedMember::ASSIGNED);
                ++$changed;
            }
        }
        $this->em->flush();

        return $changed;
    }

    private function find(Club $club, string $feedId): CalendarFeed
    {
        $feed = $this->em->getRepository(CalendarFeed::class)->find($feedId);
        if (!$feed || $feed->getClub()->getId() !== $club->getId()) {
            throw new NotFoundHttpException('Feed not found');
        }

        return $feed;
    }

    private function assertPrivate(Club $club, string $feedId): void
    {
        if (FeedVisibility::PRIVATE !== $this->find($club, $feedId)->getVisibility()) {
            throw new ApiProblemException(422, 'Only private feeds have assigned members', 'invalid_request');
        }
    }

    /** Serialises assignments and claims of the club (the claim takes the same lock) so the unique key never trips. */
    private function lockedFeed(Club $club, string $feedId): CalendarFeed
    {
        $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);

        return $this->find($club, $feedId);
    }
}
