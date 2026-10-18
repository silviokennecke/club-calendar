<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedCalendar;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\Event;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use App\Entity\EventTemplate;
use App\Entity\EventTemplateFeature;
use App\Entity\EventTemplateProperty;
use App\Entity\EventTemplateTargetGroup;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Counters for lists and delete dialogs. Every counter is ONE grouped query over all requested
 * records (no query per row). Callers only pass ids they already checked access for.
 */
readonly class UsageCounts
{
    /** Event names are listed in delete dialogs up to this many affected events (design: Dialogs). */
    public const MAX_NAMED = 3;

    public function __construct(private EntityManagerInterface $em)
    {
    }

    /**
     * @param list<string> $clubIds
     *
     * @return array<string, array{active: int, archived: int}>
     */
    public function calendarsByClub(array $clubIds): array
    {
        if ([] === $clubIds) {
            return [];
        }
        $rows = $this->em->createQueryBuilder()
            ->select('IDENTITY(c.club) AS id')
            ->addSelect('SUM(CASE WHEN c.archivedAt IS NULL THEN 1 ELSE 0 END) AS active')
            ->addSelect('SUM(CASE WHEN c.archivedAt IS NULL THEN 0 ELSE 1 END) AS archived')
            ->from(Calendar::class, 'c')
            ->where('c.club IN (:ids)')
            ->setParameter('ids', $clubIds)
            ->groupBy('c.club')
            ->getQuery()
            ->getArrayResult();

        $result = [];
        foreach ($rows as $row) {
            $result[(string) $row['id']] = ['active' => (int) $row['active'], 'archived' => (int) $row['archived']];
        }

        return $result;
    }

    /**
     * @param list<string> $clubIds
     *
     * @return array<string, int>
     */
    public function membersByClub(array $clubIds): array
    {
        return $this->grouped(ClubUser::class, 'x.club', 'u.id', 'x.club IN (:ids)', ['x.user' => 'u'], ['ids' => $clubIds]);
    }

    /**
     * Events of all calendars (active and archived) per club.
     *
     * @param list<string> $clubIds
     *
     * @return array<string, int>
     */
    public function eventsByClub(array $clubIds): array
    {
        return $this->grouped(Event::class, 'c.club', 'x.id', 'c.club IN (:ids)', ['x.calendar' => 'c'], ['ids' => $clubIds]);
    }

    /**
     * @param list<string> $clubIds
     *
     * @return array<string, int>
     */
    public function feedsByClub(array $clubIds): array
    {
        return $this->grouped(CalendarFeed::class, 'x.club', 'x.id', 'x.club IN (:ids)', [], ['ids' => $clubIds]);
    }

    /**
     * @param list<string> $calendarIds
     *
     * @return array{events: array<string, int>, templates: array<string, int>, feeds: array<string, int>, exclusiveFeeds: array<string, int>}
     */
    public function byCalendar(array $calendarIds): array
    {
        return [
            'events' => $this->grouped(Event::class, 'x.calendar', 'x.id', 'x.calendar IN (:ids)', [], ['ids' => $calendarIds]),
            'templates' => $this->grouped(EventTemplate::class, 'x.calendar', 'x.id', 'x.calendar IN (:ids)', [], ['ids' => $calendarIds]),
            // feeds that include the calendar
            'feeds' => $this->grouped(CalendarFeedCalendar::class, 'x.calendar', 'x.feed', 'x.calendar IN (:ids)', [], ['ids' => $calendarIds]),
            // feeds whose only calendar is this one (deleted together with it)
            'exclusiveFeeds' => $this->grouped(
                CalendarFeedCalendar::class,
                'x.calendar',
                'x.feed',
                'x.calendar IN (:ids) AND NOT EXISTS (SELECT 1 FROM '.CalendarFeedCalendar::class.' y WHERE y.feed = x.feed AND y.calendar <> x.calendar)',
                [],
                ['ids' => $calendarIds],
            ),
        ];
    }

    /**
     * Usage of the properties of a calendar: events, templates and the names of the events when at most
     * MAX_NAMED events are affected (otherwise an empty list).
     *
     * @return array<string, array{events: int, templates: int, eventNames: list<string>}>
     */
    public function propertyUsage(Calendar $calendar): array
    {
        return $this->linkUsage($calendar, Property::class, EventProperty::class, 'property', EventTemplateProperty::class);
    }

    /** @return array<string, array{events: int, templates: int, eventNames: list<string>}> */
    public function featureUsage(Calendar $calendar): array
    {
        return $this->linkUsage($calendar, Feature::class, EventFeature::class, 'feature', EventTemplateFeature::class);
    }

    /**
     * Like propertyUsage, plus the number of feeds that selected the target group.
     *
     * @return array<string, array{events: int, templates: int, feeds: int, eventNames: list<string>}>
     */
    public function targetGroupUsage(Club $club): array
    {
        $usage = $this->linkUsage($club, TargetGroup::class, EventTargetGroup::class, 'targetGroup', EventTemplateTargetGroup::class);
        $feeds = $this->grouped(CalendarFeedTargetGroup::class, 'x.targetGroup', 'f.id', 'o.club = :club', ['x.targetGroup' => 'o', 'x.feed' => 'f'], ['club' => $club]);
        $result = [];
        foreach ($usage as $id => $u) {
            $result[$id] = ['events' => $u['events'], 'templates' => $u['templates'], 'feeds' => $feeds[$id] ?? 0, 'eventNames' => $u['eventNames']];
        }

        return $result;
    }

    /**
     * Events and templates at the locations of a club (all its calendars), with the names of the templates that use a
     * location as their default place when at most MAX_NAMED do.
     *
     * @return array<string, array{events: int, templates: int, templateNames: list<string>}>
     */
    public function locationUsage(Club $club): array
    {
        $events = $this->grouped(Event::class, 'x.location', 'x.id', 'o.club = :club', ['x.location' => 'o'], ['club' => $club]);
        $templates = $this->grouped(EventTemplate::class, 'x.location', 'x.id', 'o.club = :club', ['x.location' => 'o'], ['club' => $club]);
        $names = $this->namesOf(EventTemplate::class, 'location', $this->fewUses($templates), 'x.name');

        $ids = $this->em->createQueryBuilder()
            ->select('l.id')->from(Location::class, 'l')
            ->where('l.club = :club')->setParameter('club', $club)
            ->getQuery()->getSingleColumnResult();

        $result = [];
        foreach ($ids as $id) {
            $result[$id] = ['events' => $events[$id] ?? 0, 'templates' => $templates[$id] ?? 0, 'templateNames' => $names[$id] ?? []];
        }

        return $result;
    }

    /**
     * Events created from each template of a calendar.
     *
     * @return array<string, int>
     */
    public function eventsByTemplate(Calendar $calendar): array
    {
        return $this->grouped(Event::class, 'x.template', 'x.id', 'x.calendar = :cal AND x.template IS NOT NULL', [], ['cal' => $calendar]);
    }

    /**
     * @param class-string $ownerClass
     * @param class-string $eventLink
     * @param class-string $templateLink
     *
     * @return array<string, array{events: int, templates: int, eventNames: list<string>}>
     */
    private function linkUsage(Club|Calendar $scope, string $ownerClass, string $eventLink, string $field, string $templateLink): array
    {
        $col = $scope instanceof Club ? 'club' : 'calendar';
        $events = $this->grouped($eventLink, "x.$field", 'e.id', "o.$col = :scope", ["x.$field" => 'o', 'x.event' => 'e'], ['scope' => $scope]);
        $templates = $this->grouped($templateLink, "x.$field", 't.id', "o.$col = :scope", ["x.$field" => 'o', 'x.template' => 't'], ['scope' => $scope]);

        $few = $this->fewUses($events);
        $names = [];
        if ([] !== $few) {
            $rows = $this->em->createQueryBuilder()
                ->select("IDENTITY(x.$field) AS id", 'e.name AS name')
                ->from($eventLink, 'x')
                ->join('x.event', 'e')
                ->where("x.$field IN (:ids)")
                ->setParameter('ids', $few)
                ->orderBy('e.date', 'ASC')
                ->addOrderBy('e.timeBegin', 'ASC')
                ->getQuery()->getArrayResult();
            $names = $this->collectNames($rows);
        }

        $ids = $this->em->createQueryBuilder()
            ->select('o.id')->from($ownerClass, 'o')
            ->where("o.$col = :scope")->setParameter('scope', $scope)
            ->getQuery()->getSingleColumnResult();

        $result = [];
        foreach ($ids as $id) {
            $result[$id] = ['events' => $events[$id] ?? 0, 'templates' => $templates[$id] ?? 0, 'eventNames' => $names[$id] ?? []];
        }

        return $result;
    }

    /**
     * Names of the records of $class whose $field is one of $ids (one query), grouped by that id.
     *
     * @param class-string $class
     * @param list<string> $ids
     *
     * @return array<string, list<string>>
     */
    private function namesOf(string $class, string $field, array $ids, string $nameExpr): array
    {
        if ([] === $ids) {
            return [];
        }
        $rows = $this->em->createQueryBuilder()
            ->select("IDENTITY(x.$field) AS id", "$nameExpr AS name")
            ->from($class, 'x')
            ->where("x.$field IN (:ids)")
            ->setParameter('ids', $ids)
            ->orderBy('x.name', 'ASC')
            ->getQuery()->getArrayResult();

        return $this->collectNames($rows);
    }

    /**
     * @param list<array{id: mixed, name: mixed}> $rows
     *
     * @return array<string, list<string>> distinct, trimmed, non-empty names per id
     */
    private function collectNames(array $rows): array
    {
        $names = [];
        foreach ($rows as $row) {
            $name = trim((string) $row['name']);
            $id = (string) $row['id'];
            if ('' !== $name && !in_array($name, $names[$id] ?? [], true)) {
                $names[$id][] = $name;
            }
        }

        return $names;
    }

    /**
     * @param array<string, int> $counts
     *
     * @return list<string> ids used at least once and at most MAX_NAMED times
     */
    private function fewUses(array $counts): array
    {
        return array_values(array_map('strval', array_keys(array_filter($counts, fn (int $n) => $n > 0 && $n <= self::MAX_NAMED))));
    }

    /**
     * COUNT($countExpr) of $class (alias `x`) grouped by $groupExpr, in one query.
     *
     * @param class-string          $class
     * @param array<string, string> $joins  path => alias (inner joins)
     * @param array<string, mixed>  $params a parameter with an empty list yields no rows
     *
     * @return array<string, int>
     */
    private function grouped(string $class, string $groupExpr, string $countExpr, string $where, array $joins, array $params): array
    {
        foreach ($params as $value) {
            if ([] === $value) {
                return [];
            }
        }
        $qb = $this->em->createQueryBuilder()
            ->from($class, 'x')
            ->select("IDENTITY($groupExpr) AS id", "COUNT($countExpr) AS n")
            ->where($where)
            ->groupBy($groupExpr);
        foreach ($joins as $path => $alias) {
            $qb->join($path, $alias);
        }
        foreach ($params as $name => $value) {
            $qb->setParameter($name, $value);
        }

        $result = [];
        foreach ($qb->getQuery()->getArrayResult() as $row) {
            $result[(string) $row['id']] = (int) $row['n'];
        }

        return $result;
    }
}
