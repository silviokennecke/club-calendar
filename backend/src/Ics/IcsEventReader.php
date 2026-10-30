<?php

declare(strict_types=1);

namespace App\Ics;

use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\QueryBuilder;

/**
 * Reads the events of an ICS output as plain rows (no entity hydration: no UnitOfWork, proxies or association
 * entities, which dominated the memory of large feeds). Location columns come from a join, the assignments from
 * one query per association and chunk of events.
 */
class IcsEventReader
{
    public const DEFAULT_CHUNK_SIZE = 500;

    public function __construct(private EntityManagerInterface $em, private int $chunkSize = self::DEFAULT_CHUNK_SIZE)
    {
        if ($chunkSize < 1) {
            throw new \InvalidArgumentException('chunkSize must be >= 1');
        }
    }

    /**
     * Reads the events in chunks (keyset pagination over date, time_begin, id), so only one chunk of rows and
     * assignments is in memory at a time. Each chunk is a list of events in output order; `$limit` caps the total
     * over all chunks (null = unlimited).
     *
     * @param QueryBuilder $qb    an event query with root alias `e` (filters, window); the select and ordering
     *                            (date, time, id) are set here, a max-results setting is ignored (use `$limit`)
     * @param int|null     $limit maximum number of events over all chunks
     *
     * @return \Generator<int, list<IcsEvent>>
     */
    public function chunks(QueryBuilder $qb, ?int $limit = null): \Generator
    {
        $base = clone $qb;
        $base->select(
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

        $remaining = $limit;
        $last = null;
        while (null === $remaining || $remaining > 0) {
            $size = null === $remaining ? $this->chunkSize : min($this->chunkSize, $remaining);
            $query = clone $base;
            if (null !== $last) {
                $query->andWhere('(e.date > :kDate OR (e.date = :kDate AND (e.timeBegin > :kTime OR (e.timeBegin = :kTime AND e.id > :kId))))')
                    ->setParameter('kDate', $last['date'], Types::DATE_IMMUTABLE)
                    ->setParameter('kTime', $last['timeBegin'])
                    ->setParameter('kId', $last['id']);
            }
            $rows = $query->setMaxResults($size)->getQuery()->getArrayResult();
            if ([] === $rows) {
                return;
            }
            yield $this->toEvents($rows);

            if (count($rows) < $size) {
                return;
            }
            $last = $rows[array_key_last($rows)];
            if (null !== $remaining) {
                $remaining -= count($rows);
            }
            unset($rows);
        }
    }

    /**
     * @param list<array<string, mixed>> $rows
     *
     * @return list<IcsEvent>
     */
    private function toEvents(array $rows): array
    {
        $ids = array_column($rows, 'id');
        $icons = $this->names(EventProperty::class, 'ep', 'property', 'x.icon', $ids);
        $propNames = $this->names(EventProperty::class, 'ep', 'property', 'x.name', $ids);
        $features = $this->names(EventFeature::class, 'ep', 'feature', 'x.name', $ids);
        $groups = $this->names(EventTargetGroup::class, 'ep', 'targetGroup', 'x.name', $ids);

        $events = [];
        foreach ($rows as $r) {
            $id = $r['id'];
            [$propIcons, $propLabels] = $this->iconsWithNames($icons[$id] ?? [], $propNames[$id] ?? []);
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
                $propIcons,
                $propLabels,
                $features[$id] ?? [],
                $groups[$id] ?? [],
            );
        }

        return $events;
    }

    /**
     * @param list<?string> $icons
     * @param list<?string> $names same order as $icons
     *
     * @return array{list<string>, list<string>} icons and names of the properties that have an icon
     */
    private function iconsWithNames(array $icons, array $names): array
    {
        $outIcons = $outNames = [];
        foreach ($icons as $i => $icon) {
            if (null !== $icon && '' !== $icon) {
                $outIcons[] = $icon;
                $outNames[] = (string) ($names[$i] ?? '');
            }
        }

        return [$outIcons, $outNames];
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
