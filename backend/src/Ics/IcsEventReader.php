<?php

declare(strict_types=1);

namespace App\Ics;

use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\QueryBuilder;

/**
 * Reads the events of an ICS output as plain rows (no entity hydration: no UnitOfWork, proxies or association
 * entities, which dominated the memory of large feeds). Location columns come from a join, the assignments from
 * one query per association and batch of events.
 */
readonly class IcsEventReader
{
    /** Events per assignment query. */
    private const BATCH = 500;

    public function __construct(private EntityManagerInterface $em)
    {
    }

    /**
     * @param QueryBuilder $qb an event query with root alias `e` (filters, window, limit); the select and ordering
     *                         (date, time, id) are set here
     *
     * @return list<IcsEvent>
     */
    public function read(QueryBuilder $qb): array
    {
        $qb->select(
            'e.id AS id', 'e.name AS name', 'e.timezone AS timezone', 'e.date AS date', 'e.dateEnd AS dateEnd',
            'e.timeBegin AS timeBegin', 'e.timeEnd AS timeEnd', 'e.isAllDay AS isAllDay', 'e.isDraft AS isDraft', 'e.note AS note',
            'cal.timezone AS calendarTimezone',
            'l.id AS locationId', 'l.name AS locationName', 'l.street AS street', 'l.zip AS zip', 'l.city AS city',
            'l.country AS country', 'l.latitude AS latitude', 'l.longitude AS longitude',
        )
            ->innerJoin('e.calendar', 'cal')
            ->leftJoin('e.location', 'l')
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC')
            ->addOrderBy('e.id', 'ASC');

        $events = [];
        foreach (array_chunk($qb->getQuery()->getArrayResult(), self::BATCH) as $rows) {
            $ids = array_column($rows, 'id');
            $icons = $this->names(EventProperty::class, 'ep', 'property', 'x.icon', $ids);
            $features = $this->names(EventFeature::class, 'ep', 'feature', 'x.name', $ids);
            $groups = $this->names(EventTargetGroup::class, 'ep', 'targetGroup', 'x.name', $ids);

            foreach ($rows as $r) {
                $id = $r['id'];
                $events[] = new IcsEvent(
                    $id,
                    $r['name'],
                    $r['timezone'],
                    $r['calendarTimezone'],
                    $r['date']->format('Y-m-d'),
                    $r['dateEnd']?->format('Y-m-d'),
                    $r['timeBegin'],
                    $r['timeEnd'],
                    (bool) $r['isAllDay'],
                    (bool) $r['isDraft'],
                    $r['note'],
                    null === $r['locationId'] ? null : new IcsLocation(
                        $r['locationName'],
                        $r['street'],
                        $r['zip'],
                        $r['city'],
                        $r['country'],
                        null === $r['latitude'] ? null : (float) $r['latitude'],
                        null === $r['longitude'] ? null : (float) $r['longitude'],
                    ),
                    array_values(array_filter($icons[$id] ?? [])),
                    $features[$id] ?? [],
                    $groups[$id] ?? [],
                );
            }
        }

        return $events;
    }

    /**
     * @param class-string $assignment
     * @param list<string> $eventIds
     *
     * @return array<string, list<?string>> values per event id, in the order of the assigned entity's id
     */
    private function names(string $assignment, string $alias, string $target, string $column, array $eventIds): array
    {
        $rows = $this->em->createQueryBuilder()
            ->select("IDENTITY($alias.event) AS eventId", "$column AS value")
            ->from($assignment, $alias)
            ->join("$alias.$target", 'x')
            ->where("$alias.event IN (:ids)")
            ->setParameter('ids', $eventIds)
            ->orderBy("$alias.event", 'ASC')
            ->addOrderBy("$alias.$target", 'ASC')
            ->getQuery()
            ->getArrayResult();

        $byEvent = [];
        foreach ($rows as $row) {
            $byEvent[(string) $row['eventId']][] = $row['value'];
        }

        return $byEvent;
    }
}
