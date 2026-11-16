<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Double-booking check of resources of type location (event.location_id), see docs/ops/RESOURCE_PLANNING.md.
 *
 * Slots are plain arrays (id, name, calendarName, locationId, date, dateEnd, timeBegin, timeEnd, allDay, draft, tz).
 * Absolute instants, so events in different zones compare correctly. The buffer of the resource is required between
 * a non-all-day event and any other event; a gap shorter than the buffer is a `buffer` conflict (always a warning).
 */
readonly class ResourceConflictService
{
    public const CODE = 'resource_conflict';
    public const KIND_OVERLAP = 'overlap';
    public const KIND_BUFFER = 'buffer';

    /** Days around the candidates read from the database (buffer max. 1 day plus zone differences). */
    private const WINDOW_DAYS = 3;

    public function __construct(private EntityManagerInterface $em)
    {
    }

    /**
     * Live check for the event form.
     *
     * @param array<string, mixed> $data
     *
     * @return array{conflicts: list<array<string, mixed>>, blocking: bool}
     */
    public function check(Calendar $calendar, array $data, bool $staff): array
    {
        $slot = $this->slotFromInput($calendar, $data);
        $exclude = [];
        if (isset($data['eventId']) && is_string($data['eventId'])) {
            $exclude[] = strtolower($data['eventId']);
        }
        $hits = $this->evaluate($calendar->getClub()->getId(), [$slot], $exclude, false);

        return [
            'conflicts' => array_map(fn (array $h) => $this->serialize($h, $staff, false), $hits),
            'blocking' => [] !== array_filter($hits, fn (array $h) => 'error' === $h['severity']),
        ];
    }

    /**
     * Locks the resources and fails with 422 `resource_conflict` when a published event of $events collides with a
     * published event (or with another event of $events) in a way that is an error. Call inside the transaction
     * that writes the events, before the flush. Drafts are ignored.
     *
     * @param list<Event> $events
     * @param bool        $asPublished treat $events as published (bulk publish, before the status update)
     */
    public function assertCanPublish(array $events, bool $asPublished = false): void
    {
        $slots = [];
        $club = null;
        foreach ($events as $event) {
            if ((!$asPublished && $event->isDraft()) || null === $event->getLocation()) {
                continue;
            }
            $slots[] = ['draft' => false] + $this->slotFromEvent($event);
            $club ??= $event->getCalendar()->getClub()->getId();
        }
        if ([] === $slots || null === $club) {
            return;
        }

        $this->lock($club, array_values(array_unique(array_column($slots, 'locationId'))));
        $hits = array_values(array_filter(
            $this->evaluate($club, $slots, [], true),
            fn (array $h) => 'error' === $h['severity'],
        ));
        if ([] === $hits) {
            return;
        }

        throw new ApiProblemException(422, 'The resource is already booked at this time', self::CODE, null, [], null, ['conflicts' => array_map(fn (array $h) => $this->serialize($h, true, true), $hits)]);
    }

    /**
     * Runs $work in a transaction. Unlike EntityManager::wrapInTransaction() a failure leaves the manager open
     * (it is cleared, so rejected new events are not flushed later).
     *
     * @template T
     *
     * @param callable(): T $work
     *
     * @return T
     */
    public function atomically(callable $work): mixed
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

    /** Identity of everything that decides a conflict; equal before and after means the check can be skipped. */
    public static function scheduleKey(Event $event): string
    {
        return implode('|', [
            $event->getLocation()?->getId(),
            $event->getDate()->format('Y-m-d'),
            $event->getDateEnd()?->format('Y-m-d'),
            $event->getTimeBegin(),
            $event->getTimeEnd(),
            $event->isAllDay() ? '1' : '0',
            $event->getTimezone(),
            $event->isDraft() ? '1' : '0',
        ]);
    }

    /** @param list<string> $locationIds */
    private function lock(string $clubId, array $locationIds): void
    {
        $this->em->getConnection()->fetchFirstColumn(
            'SELECT id FROM resource WHERE club_id = ? AND location_id IN (?) ORDER BY id FOR UPDATE',
            [$clubId, $locationIds],
            [1 => ArrayParameterType::STRING],
        );
    }

    /**
     * @param list<array<string, mixed>> $slots   the new/changed events
     * @param list<string>               $exclude extra event ids to ignore (the event being edited)
     * @param bool                       $locking read the existing events with a shared lock (sees the latest commits)
     *
     * @return list<array{subject: array<string, mixed>, other: array<string, mixed>, kind: string, severity: string, resource: array<string, mixed>}>
     */
    private function evaluate(string $clubId, array $slots, array $exclude, bool $locking): array
    {
        $locationIds = array_values(array_unique(array_column($slots, 'locationId')));
        if ([] === $locationIds) {
            return [];
        }
        $conn = $this->em->getConnection();
        $resources = [];
        foreach ($conn->fetchAllAssociative(
            "SELECT id, name, location_id, allow_double_booking, buffer_minutes FROM resource WHERE club_id = ? AND type = 'location' AND location_id IN (?)",
            [$clubId, $locationIds],
            [1 => ArrayParameterType::STRING],
        ) as $row) {
            $resources[$row['location_id']] = $row;
        }
        if ([] === $resources) {
            return [];
        }
        $slots = array_values(array_filter($slots, fn (array $s) => isset($resources[$s['locationId']])));

        $min = null;
        $max = null;
        foreach ($slots as $s) {
            $min = null === $min || $s['date'] < $min ? $s['date'] : $min;
            $end = $s['dateEnd'] ?? $s['date'];
            $max = null === $max || $end > $max ? $end : $max;
        }
        $from = (new \DateTimeImmutable($min))->modify('-'.self::WINDOW_DAYS.' days')->format('Y-m-d');
        $to = (new \DateTimeImmutable($max))->modify('+'.self::WINDOW_DAYS.' days')->format('Y-m-d');

        $skip = array_flip(array_merge($exclude, array_column($slots, 'id')));
        $rows = $conn->fetchAllAssociative(
            'SELECT e.id, e.name, e.location_id, e.date, e.date_end, e.time_begin, e.time_end, e.is_all_day, e.is_draft,'
            .' cal.name AS calendar_name, COALESCE(e.timezone, cal.timezone, club.timezone) AS tz'
            .' FROM event e JOIN calendar cal ON cal.id = e.calendar_id JOIN club ON club.id = cal.club_id'
            .' WHERE e.location_id IN (?) AND e.date <= ? AND COALESCE(e.date_end, e.date) >= ?'
            .($locking ? ' LOCK IN SHARE MODE' : ''),
            [array_keys($resources), $to, $from],
            [0 => ArrayParameterType::STRING],
        );

        $byLocation = [];
        foreach ($rows as $row) {
            if (isset($skip[strtolower((string) $row['id'])])) {
                continue;
            }
            $byLocation[$row['location_id']][] = $this->prepare([
                'id' => $row['id'],
                'name' => $row['name'],
                'calendarName' => $row['calendar_name'],
                'locationId' => $row['location_id'],
                'date' => $row['date'],
                'dateEnd' => $row['date_end'],
                'timeBegin' => $row['time_begin'],
                'timeEnd' => $row['time_end'],
                'allDay' => (bool) $row['is_all_day'],
                'draft' => (bool) $row['is_draft'],
                'tz' => $row['tz'],
            ]);
        }

        $subjects = array_map($this->prepare(...), $slots);
        $hits = [];
        foreach ($subjects as $i => $subject) {
            $resource = $resources[$subject['locationId']];
            $buffer = (int) $resource['buffer_minutes'] * 60;
            $double = (bool) $resource['allow_double_booking'];
            $others = $byLocation[$subject['locationId']] ?? [];
            // Subjects of the same batch collide with each other once (pair i < j)
            foreach ($subjects as $j => $other) {
                if ($j > $i && $other['locationId'] === $subject['locationId']) {
                    $others[] = $other;
                }
            }
            foreach ($others as $other) {
                $kind = $this->kind($subject, $other, $buffer);
                if (null === $kind) {
                    continue;
                }
                $error = self::KIND_OVERLAP === $kind && !$subject['draft'] && !$other['draft'] && !$double;
                $hits[] = [
                    'subject' => $subject,
                    'other' => $other,
                    'kind' => $kind,
                    'severity' => $error ? 'error' : 'warning',
                    'resource' => $resource,
                ];
            }
        }

        usort($hits, fn (array $a, array $b) => [$a['other']['start'], $a['other']['id']] <=> [$b['other']['start'], $b['other']['id']]);

        return $hits;
    }

    /** @param array<string, mixed> $a @param array<string, mixed> $b */
    private function kind(array $a, array $b, int $buffer): ?string
    {
        if ($a['start'] < $b['end'] && $b['start'] < $a['end']) {
            return self::KIND_OVERLAP;
        }
        if ($buffer > 0) {
            if (!$a['allDay'] && $a['start'] - $buffer < $b['end'] && $b['start'] < $a['end'] + $buffer) {
                return self::KIND_BUFFER;
            }
            if (!$b['allDay'] && $b['start'] - $buffer < $a['end'] && $a['start'] < $b['end'] + $buffer) {
                return self::KIND_BUFFER;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $slot
     *
     * @return array<string, mixed> the slot with absolute `start`/`end` (unix seconds)
     */
    private function prepare(array $slot): array
    {
        $slot['id'] = strtolower((string) $slot['id']);
        try {
            $tz = new \DateTimeZone($slot['tz'] ?: 'UTC');
        } catch (\Exception) {
            $tz = new \DateTimeZone('UTC');
        }
        $date = (string) $slot['date'];
        $endDate = (string) ($slot['dateEnd'] ?? $date);
        if ($slot['allDay']) {
            $start = new \DateTimeImmutable($date.' 00:00', $tz);
            $end = (new \DateTimeImmutable($endDate.' 00:00', $tz))->modify('+1 day');
        } else {
            $start = new \DateTimeImmutable($date.' '.$slot['timeBegin'], $tz);
            $end = new \DateTimeImmutable($endDate.' '.$slot['timeEnd'], $tz);
            if ($end < $start && null === ($slot['dateEnd'] ?? null)) {
                $end = $end->modify('+1 day');
            }
        }
        $slot['start'] = $start->getTimestamp();
        $slot['end'] = max($end->getTimestamp(), $slot['start'] + 60);

        return $slot;
    }

    /** @return array<string, mixed> */
    private function slotFromEvent(Event $event): array
    {
        $calendar = $event->getCalendar();

        return [
            'id' => $event->getId(),
            'name' => $event->getName(),
            'calendarName' => $calendar->getName(),
            'locationId' => $event->getLocation()?->getId(),
            'date' => $event->getDate()->format('Y-m-d'),
            'dateEnd' => $event->getDateEnd()?->format('Y-m-d'),
            'timeBegin' => $event->getTimeBegin(),
            'timeEnd' => $event->getTimeEnd(),
            'allDay' => $event->isAllDay(),
            'draft' => $event->isDraft(),
            'tz' => $event->getTimezone() ?? $calendar->getTimezone() ?? $calendar->getClub()->getTimezone(),
        ];
    }

    /**
     * @param array<string, mixed> $data
     *
     * @return array<string, mixed>
     */
    private function slotFromInput(Calendar $calendar, array $data): array
    {
        $locationId = $data['locationId'] ?? null;
        if (!is_string($locationId) || '' === $locationId) {
            throw Input::invalid('locationId', 'locationId must be an id');
        }
        $allDay = array_key_exists('isAllDay', $data) && null !== $data['isAllDay'] && Input::bool($data, 'isAllDay');
        $dateEnd = $data['dateEnd'] ?? null;
        $timezone = Input::timezone($data, 'timezone');

        return [
            'id' => 'candidate',
            'name' => '',
            'calendarName' => $calendar->getName(),
            'locationId' => strtolower($locationId),
            'date' => Input::date($data, 'date')->format('Y-m-d'),
            'dateEnd' => null === $dateEnd || '' === $dateEnd ? null : Input::parseDate($dateEnd, 'dateEnd')->format('Y-m-d'),
            'timeBegin' => $allDay && !isset($data['timeBegin']) ? '00:00' : Input::time($data, 'timeBegin'),
            'timeEnd' => $allDay && !isset($data['timeEnd']) ? '23:59' : Input::time($data, 'timeEnd'),
            'allDay' => $allDay,
            'draft' => !array_key_exists('isDraft', $data) || null === $data['isDraft'] || Input::bool($data, 'isDraft'),
            'tz' => $timezone ?? $calendar->getTimezone() ?? $calendar->getClub()->getTimezone(),
        ];
    }

    /**
     * @param array{subject: array<string, mixed>, other: array<string, mixed>, kind: string, severity: string, resource: array<string, mixed>} $hit
     *
     * @return array<string, mixed>
     */
    private function serialize(array $hit, bool $staff, bool $forEvent): array
    {
        $o = $hit['other'];
        $item = [
            'kind' => $hit['kind'],
            'severity' => $hit['severity'],
            'resourceId' => $hit['resource']['id'],
            'resourceName' => $hit['resource']['name'],
            'calendarName' => $o['calendarName'],
            'date' => $o['date'],
            'dateEnd' => $o['dateEnd'],
            'timeBegin' => $o['timeBegin'],
            'timeEnd' => $o['timeEnd'],
            'isAllDay' => $o['allDay'],
            'isDraft' => $o['draft'],
        ];
        if ($staff) {
            $item['eventId'] = $o['id'];
            $item['eventName'] = $o['name'];
        }
        if ($forEvent) {
            $item['forEventId'] = $hit['subject']['id'];
            $item['forDate'] = $hit['subject']['date'];
        }

        return $item;
    }
}
