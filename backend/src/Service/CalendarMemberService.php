<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarMember;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

/** Per-calendar permissions of club members (see CalendarMember). Managed by club admins only. */
readonly class CalendarMemberService
{
    public function __construct(
        private EntityManagerInterface $em,
        private Quota $quota,
    ) {
    }

    /**
     * @return list<array{userId: string, name: string, email: string, clubRole: string, createdAt: string}>
     */
    public function list(Calendar $calendar): array
    {
        $rows = $this->em->createQueryBuilder()
            ->select('u.id AS userId', 'u.name AS name', 'u.email AS email', 'cu.role AS clubRole', 'm.createdAt AS createdAt')
            ->from(CalendarMember::class, 'm')
            ->join('m.user', 'u')
            ->join(ClubUser::class, 'cu', 'WITH', 'cu.user = u AND cu.club = :club')
            ->where('m.calendar = :calendar')
            ->setParameter('calendar', $calendar)
            ->setParameter('club', $calendar->getClub())
            ->orderBy('u.name', 'ASC')
            ->addOrderBy('u.id', 'ASC')
            ->getQuery()
            ->getArrayResult();

        return array_map(static fn (array $r) => self::item($r), $rows);
    }

    /**
     * Grants the permission to a member of the calendar's club (any club role; 422 `unknown_reference` otherwise).
     * Idempotent. Runs under the club row lock, so a concurrent removal from the club cannot leave a row behind.
     *
     * @return array{item: array<string, mixed>, created: bool}
     */
    public function add(Calendar $calendar, string $userId, User $actor): array
    {
        $club = $calendar->getClub();

        return $this->atomically(function () use ($calendar, $club, $userId, $actor): array {
            $this->em->lock($club, LockMode::PESSIMISTIC_WRITE);
            $cu = '' === $userId ? null : $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $userId]);
            if (null === $cu) {
                throw CalendarReferences::unknown('userId', $userId, $club);
            }
            $user = $cu->getUser();
            $row = $this->em->getRepository(CalendarMember::class)->findOneBy(['calendar' => $calendar, 'user' => $user]);
            $created = null === $row;
            if ($created) {
                $this->quota->assertRoom(Quota::CALENDAR_MEMBERS_PER_CALENDAR, $calendar);
                $row = new CalendarMember($calendar, $user, $actor);
                $this->em->persist($row);
                $this->em->flush();
            }

            return [
                'item' => self::item([
                    'userId' => $user->getId(), 'name' => $user->getName(), 'email' => $user->getEmail(),
                    'clubRole' => $cu->getRole(), 'createdAt' => $row->getCreatedAt(),
                ]),
                'created' => $created,
            ];
        });
    }

    /** Like wrapInTransaction, but a rejected request leaves the entity manager open (it is cleared). */
    private function atomically(callable $work): array
    {
        $conn = $this->em->getConnection();
        $conn->beginTransaction();
        try {
            $result = $work();
            $conn->commit();

            return $result;
        } catch (\Throwable $e) {
            $conn->rollBack();
            $this->em->clear();

            throw $e;
        }
    }

    /** Idempotent: a user without a row is simply ignored. */
    public function remove(Calendar $calendar, string $userId): void
    {
        $this->em->createQuery('DELETE FROM '.CalendarMember::class.' m WHERE m.calendar = :calendar AND IDENTITY(m.user) = :user')
            ->setParameter('calendar', $calendar)
            ->setParameter('user', $userId)
            ->execute();
    }

    /** A person who leaves or is removed from the club loses all calendar permissions of that club. */
    public function removeAllOfUserInClub(Club $club, User $user): void
    {
        $this->em->createQuery('DELETE FROM '.CalendarMember::class.' m WHERE m.user = :user AND m.calendar IN (SELECT c.id FROM '.Calendar::class.' c WHERE c.club = :club)')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->execute();
    }

    public function hasAccessInClub(Club $club, User $user): bool
    {
        return (int) $this->em->createQuery('SELECT COUNT(m.id) FROM '.CalendarMember::class.' m JOIN m.calendar c WHERE m.user = :user AND c.club = :club')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->getSingleScalarResult() > 0;
    }

    public function role(Club $club, User $user): ?ClubRole
    {
        return $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user])?->getRole();
    }

    /** @return list<string> ids of the calendars of the club the user holds a permission for */
    public function calendarIds(Club $club, User $user): array
    {
        $rows = $this->em->createQuery('SELECT c.id FROM '.CalendarMember::class.' m JOIN m.calendar c WHERE m.user = :user AND c.club = :club')
            ->setParameter('user', $user)
            ->setParameter('club', $club)
            ->getSingleColumnResult();

        return array_values($rows);
    }

    /**
     * Minimal calendar data per club for the given clubs (one query), only calendars with a permission row.
     *
     * @param list<string> $clubIds
     *
     * @return array<string, list<array{id: string, name: string, timezone: ?string, archivedAt: ?string}>>
     */
    public function calendarsByClub(User $user, array $clubIds): array
    {
        if ([] === $clubIds) {
            return [];
        }
        $rows = $this->em->createQuery('SELECT IDENTITY(c.club) AS clubId, c.id AS id, c.name AS name, c.timezone AS timezone, c.archivedAt AS archivedAt FROM '.CalendarMember::class.' m JOIN m.calendar c WHERE m.user = :user AND c.club IN (:clubs) ORDER BY c.name, c.id')
            ->setParameter('user', $user)
            ->setParameter('clubs', $clubIds)
            ->getArrayResult();
        $out = [];
        foreach ($rows as $r) {
            $out[$r['clubId']][] = [
                'id' => $r['id'],
                'name' => $r['name'],
                'timezone' => $r['timezone'],
                'archivedAt' => $r['archivedAt']?->format(\DATE_ATOM),
            ];
        }

        return $out;
    }

    /**
     * @param array{userId: string, name: string, email: string, clubRole: ClubRole|string, createdAt: \DateTimeInterface} $r
     *
     * @return array{userId: string, name: string, email: string, clubRole: string, createdAt: string}
     */
    private static function item(array $r): array
    {
        return [
            'userId' => $r['userId'],
            'name' => $r['name'],
            'email' => $r['email'],
            'clubRole' => $r['clubRole'] instanceof ClubRole ? $r['clubRole']->value : (string) $r['clubRole'],
            'createdAt' => $r['createdAt']->format(\DATE_ATOM),
        ];
    }
}
