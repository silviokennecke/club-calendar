<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\Resource;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\ResourceVisibility;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\ParameterType;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Read side of the resource calendar: all events of the club at the resource's location, over ALL calendars of
 * the club including archived ones (they still occupy the place in the past), as plain array rows.
 * Staff (viewer+) see full items; a plain `member` only gets busy items of `members` resources, everything else
 * is the same 404 `resource_not_found`, so a hidden resource's existence is not leaked.
 */
readonly class ResourceCalendarService
{
    public const CODE_NOT_FOUND = 'resource_not_found';

    public function __construct(
        private EntityManagerInterface $em,
    ) {
    }

    public function role(Club $club, User $user): ?ClubRole
    {
        return $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user])?->getRole();
    }

    /**
     * @param array<string, mixed> $query
     *
     * @return array{items: list<array<string, mixed>>, total: int}
     */
    public function events(Club $club, string $id, User $user, array $query): array
    {
        $role = $this->role($club, $user);
        $staff = null !== $role && $role->atLeast(ClubRole::VIEWER);

        $resource = $this->em->getRepository(Resource::class)->find($id);
        if (!$resource || $resource->getClub()->getId() !== $club->getId()
            || (!$staff && ResourceVisibility::MEMBERS !== $resource->getVisibility())) {
            throw new ApiProblemException(404, 'Resource not found', self::CODE_NOT_FOUND);
        }

        $from = Input::optionalDate($query['from'] ?? null, 'from') ?? throw Input::invalid('from', 'from is required');
        $to = Input::optionalDate($query['to'] ?? null, 'to') ?? throw Input::invalid('to', 'to is required');
        Input::assertDateRange($from, $to);
        Input::assertMaxRange($from, $to, EventService::LIST_MAX_RANGE_DAYS);
        $limit = Input::optionalInt($query['limit'] ?? null, 'limit', 1, EventService::LIST_MAX_LIMIT) ?? EventService::LIST_MAX_LIMIT;
        $offset = Input::optionalInt($query['offset'] ?? null, 'offset', 0, PHP_INT_MAX) ?? 0;

        $drafts = $staff && $role->atLeast(ClubRole::EDITOR);
        $where = ' FROM event e JOIN calendar cal ON cal.id = e.calendar_id JOIN club ON club.id = cal.club_id'
            .' WHERE e.type = \'event\' AND e.location_id = :loc AND e.date <= :to AND COALESCE(e.date_end, e.date) >= :from'
            .($drafts ? '' : ' AND e.is_draft = 0');
        $params = ['loc' => $resource->getLocation()->getId(), 'from' => $from->format('Y-m-d'), 'to' => $to->format('Y-m-d')];

        $conn = $this->em->getConnection();
        $total = (int) $conn->fetchOne('SELECT COUNT(*)'.$where, $params);
        $rows = $conn->fetchAllAssociative(
            'SELECT e.id, e.name, e.calendar_id, cal.name AS calendar_name, e.date, e.date_end, e.time_begin, e.time_end,'
            .' e.is_all_day, e.is_draft, COALESCE(e.timezone, cal.timezone, club.timezone) AS tz'
            .$where.' ORDER BY e.date, e.time_begin, e.id LIMIT :limit OFFSET :offset',
            $params + ['limit' => $limit, 'offset' => $offset],
            ['limit' => ParameterType::INTEGER, 'offset' => ParameterType::INTEGER],
        );

        $items = [];
        foreach ($rows as $r) {
            $item = [
                'calendarName' => $r['calendar_name'],
                'date' => (string) $r['date'],
                'dateEnd' => null !== $r['date_end'] ? (string) $r['date_end'] : null,
                'timeBegin' => $r['time_begin'],
                'timeEnd' => $r['time_end'],
                'isAllDay' => (bool) $r['is_all_day'],
                'timezone' => $r['tz'],
            ];
            if ($staff) {
                $item = ['id' => $r['id'], 'name' => $r['name'], 'calendarId' => $r['calendar_id']] + $item + ['isDraft' => (bool) $r['is_draft']];
            }
            $items[] = $item;
        }

        return ['items' => $items, 'total' => $total];
    }
}
