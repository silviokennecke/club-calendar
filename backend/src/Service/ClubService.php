<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;

readonly class ClubService
{
    public const string MEMBER_NOT_FOUND_CODE = 'member_not_found';

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
            ->select('c', 'cal.id AS lastCalendarId')
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
        foreach ($rows as $row) {
            $lastCalendars[$row[0]->getId()] = $row['lastCalendarId'];
        }

        $ids = array_map(fn (Club $c) => $c->getId(), $clubs);
        $calendars = $this->counts->calendarsByClub($ids);
        $members = $this->counts->membersByClub($ids);

        return array_map(function (Club $club) use ($calendars, $members, $lastCalendars) {
            $cals = $calendars[$club->getId()] ?? ['active' => 0, 'archived' => 0];

            return [
                'id' => $club->getId(),
                'name' => $club->getName(),
                'timezone' => $club->getTimezone(),
                'calendarCount' => $cals['active'],
                'archivedCalendarCount' => $cals['archived'],
                'memberCount' => $members[$club->getId()] ?? 0,
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
        $this->em->persist($cu);
        $this->em->flush();

        return $this->serializeClub($club);
    }

    /**
     * One club with its counters; `eventCount` and `feedCount` sum up all calendars (also archived
     * ones), i.e. what deleting the club removes.
     */
    public function getClub(Club $club): array
    {
        $id = $club->getId();
        $cals = $this->counts->calendarsByClub([$id])[$id] ?? ['active' => 0, 'archived' => 0];

        return $this->serializeClub($club) + [
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
        ], $members);
    }

    /**
     * Adds the user with this address to the club. `created` is false when the user already was a member
     * (nothing changes; the caller answers 200 instead of 201 with the same body). Unknown and unverified addresses are the same
     * 404 `member_not_found` (see the security audit: account enumeration).
     *
     * @return array{member: array{id: string, name: string, email: string}, created: bool}
     */
    public function addMember(Club $club, string $email): array
    {
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        // Unverified users (e.g. created by an SSO login that did not prove the address) are as unknown as
        // missing ones: whoever claimed the address must not get access by it.
        if (!$user || !$user->isEmailVerified()) {
            throw new ApiProblemException(404, 'Member not found', self::MEMBER_NOT_FOUND_CODE);
        }
        $member = ['id' => $user->getId(), 'name' => $user->getName(), 'email' => $user->getEmail()];
        $existing = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user]);
        if ($existing) {
            return ['member' => $member, 'created' => false];
        }
        $this->quota->assertRoom(Quota::MEMBERS_PER_CLUB, $club);
        $cu = new ClubUser();
        $cu->setClub($club);
        $cu->setUser($user);
        $this->em->persist($cu);
        $this->em->flush();

        return ['member' => $member, 'created' => true];
    }

    /**
     * Removes a member. A user id that is no member of the club, unknown or not a user id at all, is the same
     * 404 `member_not_found`: the answer never tells whether an account exists.
     */
    public function removeMember(Club $club, string $memberId): void
    {
        $cu = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $memberId]);
        if (!$cu) {
            throw new ApiProblemException(404, 'Member not found', self::MEMBER_NOT_FOUND_CODE);
        }
        $this->em->remove($cu);
        $this->em->flush();
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
