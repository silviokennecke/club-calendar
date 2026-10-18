<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

readonly class ClubService
{
    public const string MEMBER_NOT_FOUND_CODE = 'member_not_found';
    public const string LAST_MEMBER_CODE = 'last_member';
    public const string LAST_MEMBER_OF_CLUB_CODE = 'last_member_of_club';
    public const string LAST_ADMIN_CODE = 'last_admin';
    public const string LAST_ADMIN_OF_CLUB_CODE = 'last_admin_of_club';
    public const string FORBIDDEN_CODE = 'forbidden';
    public const string INVALID_ROLE_CODE = 'invalid_role';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UsageCounts $counts,
        private readonly Quota $quota,
    ) {
    }

    /**
     * The user's clubs with calendar and member counters (one grouped query per counter).
     */
    public function listClubs(User $user): array
    {
        /** @var list<array{0: Club, lastCalendarId: ?string}> $rows */
        $rows = $this->em->createQueryBuilder()
            ->select('c', 'cal.id AS lastCalendarId', 'cu.role AS role')
            ->from(Club::class, 'c')
            ->join(ClubUser::class, 'cu', 'WITH', 'cu.club = c')
            // The remembered calendar counts only while it exists and still belongs to this club.
            ->leftJoin(Calendar::class, 'cal', 'WITH', 'cal.id = cu.lastCalendarId AND cal.club = c')
            ->where('cu.user = :user')
            ->setParameter('user', $user)
            ->getQuery()
            ->getResult();
        $clubs = array_map(fn (array $row) => $row[0], $rows);
        $lastCalendars = [];
        $roles = [];
        foreach ($rows as $row) {
            $lastCalendars[$row[0]->getId()] = $row['lastCalendarId'];
            $roles[$row[0]->getId()] = $row['role'];
        }

        $ids = array_map(fn (Club $c) => $c->getId(), $clubs);
        $calendars = $this->counts->calendarsByClub($ids);
        $members = $this->counts->membersByClub($ids);

        return array_map(function (Club $club) use ($calendars, $members, $lastCalendars, $roles) {
            $cals = $calendars[$club->getId()] ?? ['active' => 0, 'archived' => 0];

            return [
                'id' => $club->getId(),
                'name' => $club->getName(),
                'timezone' => $club->getTimezone(),
                'calendarCount' => $cals['active'],
                'archivedCalendarCount' => $cals['archived'],
                'memberCount' => $members[$club->getId()] ?? 0,
                'role' => $roles[$club->getId()]->value,
                'lastCalendarId' => $lastCalendars[$club->getId()] ?? null,
                '_count' => ['calendars' => $cals['active'] + $cals['archived']],
            ];
        }, $clubs);
    }

    public function createClub(User $user, string $name, string $timezone = 'Europe/Berlin'): array
    {
        $this->quota->assertRoom(Quota::CLUBS_PER_USER, $user);
        $club = new Club();
        $club->setName($name);
        $club->setTimezone($timezone);
        $this->em->persist($club);

        $cu = new ClubUser();
        $cu->setClub($club);
        $cu->setUser($user);
        $cu->setRole(ClubRole::ADMIN);
        $this->em->persist($cu);
        $this->em->flush();

        return $this->serializeClub($club) + ['role' => ClubRole::ADMIN->value];
    }

    /**
     * One club with its counters; `eventCount` and `feedCount` sum up all calendars (also archived
     * ones), i.e. what deleting the club removes.
     */
    public function getClub(Club $club, User $viewer): array
    {
        $id = $club->getId();
        $membership = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $viewer]);
        $cals = $this->counts->calendarsByClub([$id])[$id] ?? ['active' => 0, 'archived' => 0];

        return $this->serializeClub($club) + [
            'role' => $membership?->getRole()->value,
            'calendarCount' => $cals['active'],
            'archivedCalendarCount' => $cals['archived'],
            'memberCount' => $this->counts->membersByClub([$id])[$id] ?? 0,
            'eventCount' => $this->counts->eventsByClub([$id])[$id] ?? 0,
            'feedCount' => $this->counts->feedsByClub([$id])[$id] ?? 0,
        ];
    }

    public function updateClub(Club $club, array $data): array
    {
        if (isset($data['name'])) {
            $club->setName(Input::string($data, 'name'));
        }
        if (isset($data['timezone'])) {
            $club->setTimezone((string) Input::timezone($data, 'timezone', false));
        }
        $this->em->flush();

        return $this->serializeClub($club);
    }

    public function deleteClub(Club $club): void
    {
        $this->em->remove($club);
        $this->em->flush();
    }

    public function listMembers(Club $club): array
    {
        $members = $this->em->getRepository(ClubUser::class)->findBy(['club' => $club]);

        return array_map(fn (ClubUser $cu) => [
            'id' => $cu->getUser()->getId(),
            'name' => $cu->getUser()->getName(),
            'email' => $cu->getUser()->getEmail(),
            'role' => $cu->getRole()->value,
        ], $members);
    }

    /**
     * Removes a member, or lets the actor leave (`$memberId` = the actor). Leaving is open to every role; removing
     * somebody else needs an admin (403 `forbidden`). A user id that is no member of the club, unknown or not a user
     * id at all, is the same 404 `member_not_found`: the answer never tells whether an account exists. The last member
     * can neither be removed nor leave (422 `last_member`), and neither can the last admin while others remain
     * (422 `last_admin`): a club never has zero members or zero admins. The club row is locked for the checks, so
     * two concurrent removals cannot empty the club.
     */
    public function removeMember(Club $club, string $memberId, User $actor): void
    {
        $this->em->wrapInTransaction(function () use ($club, $memberId, $actor): void {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            if ($actor->getId() !== $memberId) {
                $this->assertAdmin($club, $actor);
            }
            $cu = $this->findMembership($club, $memberId);
            if ($this->countMembers($club) <= 1) {
                throw new ApiProblemException(422, 'The last member cannot be removed from a club', self::LAST_MEMBER_CODE);
            }
            if (ClubRole::ADMIN === $cu->getRole() && $this->countAdmins($club) <= 1) {
                throw new ApiProblemException(422, 'The last admin cannot be removed from a club', self::LAST_ADMIN_CODE);
            }
            $this->em->remove($cu);
            $this->em->flush();
        });
    }

    /**
     * Changes the role of a member (admins only, 403 `forbidden` otherwise; a member can change their own role only
     * as an admin, e.g. to step down). The last admin cannot be demoted (422 `last_admin`). Returns the member as in
     * {@see listMembers()}.
     */
    public function changeRole(Club $club, string $memberId, ClubRole $role, User $actor): array
    {
        return $this->em->wrapInTransaction(function () use ($club, $memberId, $role, $actor): array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $this->assertAdmin($club, $actor);
            $cu = $this->findMembership($club, $memberId);
            if (ClubRole::ADMIN === $cu->getRole() && ClubRole::ADMIN !== $role && $this->countAdmins($club) <= 1) {
                throw new ApiProblemException(422, 'The last admin cannot be demoted', self::LAST_ADMIN_CODE);
            }
            $cu->setRole($role);
            $this->em->flush();

            return [
                'id' => $cu->getUser()->getId(),
                'name' => $cu->getUser()->getName(),
                'email' => $cu->getUser()->getEmail(),
                'role' => $cu->getRole()->value,
            ];
        });
    }

    /** Re-checked under the club lock: the role the voter saw may have changed in the meantime. */
    private function assertAdmin(Club $club, User $actor): void
    {
        $cu = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $actor]);
        if (null === $cu) {
            throw new ApiProblemException(403, 'Not a member of this club', self::FORBIDDEN_CODE);
        }
        $this->em->refresh($cu);
        if (ClubRole::ADMIN !== $cu->getRole()) {
            throw new ApiProblemException(403, 'Only club admins can do this', self::FORBIDDEN_CODE);
        }
    }

    private function findMembership(Club $club, string $memberId): ClubUser
    {
        $cu = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $memberId]);
        if (!$cu) {
            throw new ApiProblemException(404, 'Member not found', self::MEMBER_NOT_FOUND_CODE);
        }

        return $cu;
    }

    /**
     * Locks the clubs of the user (in id order, so concurrent calls cannot deadlock) and fails with 422
     * `last_member_of_club` if the user is the only member of one of them. Must run inside a transaction
     * that also removes the memberships (account deletion).
     */
    public function assertNotLastMemberAnywhere(User $user): void
    {
        $clubs = $this->em->createQueryBuilder()
            ->select('c')
            ->from(Club::class, 'c')
            ->join(ClubUser::class, 'cu', 'WITH', 'cu.club = c')
            ->where('cu.user = :user')
            ->orderBy('c.id', 'ASC')
            ->setParameter('user', $user)
            ->getQuery()
            ->getResult();
        foreach ($clubs as $club) {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
        }
        foreach ($clubs as $club) {
            if ($this->countMembers($club) <= 1) {
                throw new ApiProblemException(422, 'You are the last member of a club; delete the club first', self::LAST_MEMBER_OF_CLUB_CODE);
            }
        }
        foreach ($clubs as $club) {
            $own = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user]);
            if (ClubRole::ADMIN === $own?->getRole() && $this->countAdmins($club) <= 1) {
                throw new ApiProblemException(422, 'You are the last admin of a club; promote another member or delete the club first', self::LAST_ADMIN_OF_CLUB_CODE);
            }
        }
    }

    private function countMembers(Club $club): int
    {
        return (int) $this->em->createQuery('SELECT COUNT(cu.user) FROM '.ClubUser::class.' cu WHERE cu.club = :club')
            ->setParameter('club', $club)
            ->getSingleScalarResult();
    }

    private function countAdmins(Club $club): int
    {
        return (int) $this->em->createQuery('SELECT COUNT(cu.user) FROM '.ClubUser::class.' cu WHERE cu.club = :club AND cu.role = :admin')
            ->setParameter('club', $club)
            ->setParameter('admin', ClubRole::ADMIN)
            ->getSingleScalarResult();
    }

    private function serializeClub(Club $club): array
    {
        return [
            'id' => $club->getId(),
            'name' => $club->getName(),
            'timezone' => $club->getTimezone(),
        ];
    }
}
