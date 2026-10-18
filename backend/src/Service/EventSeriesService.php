<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventSeries;
use App\Entity\EventTargetGroup;
use App\Entity\EventTemplate;
use App\Exception\ApiProblemException;
use App\Repository\HolidayEventRepository;
use Doctrine\DBAL\Exception\DeadlockException;
use Doctrine\DBAL\Exception\ForeignKeyConstraintViolationException;
use Doctrine\DBAL\Exception\LockWaitTimeoutException;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Event series (design: EventSeries): preview of a rule, atomic creation of the series with all
 * its events and changing the rule later (preview and atomic update of the future events). The dates come from SeriesRule; holidays come from the calendar's holiday calendars
 * (overlap like `…/holiday-events`). Editing and deleting with a scope: EventService.
 */
readonly class EventSeriesService
{
    public function __construct(
        private EntityManagerInterface $em,
        private EventService $events,
        private CalendarReferences $references,
        private HolidayEventRepository $holidays,
        private ClockInterface $clock,
        private Quota $quota,
    ) {
    }

    /**
     * `{rule, event?: {durationDays}}` → `{dates, count, skippedHolidays: [{date, name}], holidays: [{date, name}]}`.
     * `holidays` = all dates of the rule that touch a holiday (skipped or kept), `skippedHolidays` = the
     * ones left out because of `skipHolidays`. Same validation as creating; writes nothing; no dates is
     * not an error here (count 0).
     */
    public function preview(Calendar $calendar, array $data): array
    {
        $event = $this->eventInput($data);
        $rule = SeriesRule::fromInput($data['rule'] ?? null, $event['durationDays'] ?? null);
        $result = $this->compute($calendar, $rule);

        return [
            'dates' => array_map(fn (\DateTimeImmutable $d) => $d->format('Y-m-d'), $result['dates']),
            'count' => count($result['dates']),
            'skippedHolidays' => $result['skipped'],
            'holidays' => $result['holidays'],
        ];
    }

    /**
     * `{rule, templateId?, event?: {name, timeBegin, timeEnd, isAllDay, timezone, locationId, propertyIds,
     * featureIds, targetGroupIds, isDraft, durationDays}, isDraft?}` → `{series, events}`. Template values
     * are taken like `from-template` (template without times → all-day); `event` fields override them.
     * Default draft. One flush (transaction): an invalid field or a reference of another calendar saves
     * nothing. No dates → 422 `validation_failed` (field `rule`), more than SeriesRule::MAX_EVENTS → 422
     * `too_many_events`.
     */
    public function create(Calendar $calendar, array $data): array
    {
        $event = $this->eventInput($data);
        $rule = SeriesRule::fromInput($data['rule'] ?? null, $event['durationDays'] ?? null);
        foreach (['date', 'dateEnd'] as $key) {
            if (array_key_exists($key, $event)) {
                throw Input::invalid("event.$key", "event.$key is set by the rule (use rule and event.durationDays)");
            }
        }
        unset($event['durationDays'], $event['externalUid'], $event['eventTemplateId']);
        $template = $this->references->find(EventTemplate::class, $calendar, $data['templateId'] ?? null, 'templateId');

        $input = $template ? $this->events->templateInput($template, $event) : $event + ['isDraft' => true];
        if (!$template && true === ($input['isAllDay'] ?? null)) {
            $input['timeBegin'] ??= '00:00';
            $input['timeEnd'] ??= '23:59';
        }
        if (array_key_exists('isDraft', $data)) {
            $input['isDraft'] = Input::bool($data, 'isDraft');
        }

        $dates = $this->compute($calendar, $rule)['dates'];
        if ([] === $dates) {
            throw new ApiProblemException(422, 'The rule creates no events', Input::CODE, 'rule');
        }

        $this->quota->assertRoom(Quota::EVENTS_PER_CALENDAR, $calendar, count($dates));
        $series = new EventSeries($calendar, $rule, $template);
        $this->em->persist($series);
        $created = [];
        foreach ($dates as $date) {
            $input['date'] = $date->format('Y-m-d');
            $input['dateEnd'] = $rule->durationDays > 0 ? $rule->endOf($date)->format('Y-m-d') : null;
            try {
                $created[] = $this->events->buildEvent($calendar, $input)->setSeries($series);
            } catch (ApiProblemException $e) {
                throw $this->inEvent($e);
            }
        }
        $this->em->flush();

        return [
            'series' => $this->events->serializeSeries($series, count($created)),
            'events' => array_map(fn (Event $e) => $this->events->serializeEvent($e), $created),
        ];
    }

    /** `GET …/event-series/{id}`: rule, template and `eventCount`; a series of another calendar is 404. */
    public function get(Calendar $calendar, string $id): array
    {
        $series = $this->findSeries($calendar, $id);

        return $this->events->serializeSeries($series, $this->events->countSeriesEvents($series));
    }

    /** 409: the series has no events left that could serve as the prototype of new events. */
    public const SERIES_EMPTY_CODE = 'series_empty';

    /** 409: events of the series changed while the rule was being changed (try again). */
    public const SERIES_CHANGED_CODE = 'series_changed';

    /**
     * `POST …/event-series/{id}/preview-update {rule}` → `{toCreate: [{date}], toDelete: [{id, date, name,
     * isDraft}], kept, past, skippedHolidays: [{date, name}]}`: what `PATCH` with the same rule would do
     * now. Writes nothing. Semantics: see update().
     */
    public function previewUpdate(Calendar $calendar, string $id, array $data): array
    {
        $plan = $this->planUpdate($calendar, $this->findSeries($calendar, $id), $data);

        return [
            'toCreate' => array_map(fn (string $date) => ['date' => $date], $plan['create']),
            'toDelete' => $plan['delete'],
            'kept' => $plan['kept'],
            'past' => $plan['past'],
            'skippedHolidays' => $plan['skipped'],
        ];
    }

    /**
     * `PATCH …/event-series/{id} {rule}` → `{series, created, deleted, kept}` (counts). Changes the rule of a
     * series and applies it to the FUTURE events (date ≥ today in the calendar's zone); past events stay as
     * they are. The new rule yields its full set of dates from its start (`count`/`until` count over the
     * whole series); dates before today are ignored. Future events on a date of the set stay unchanged (also
     * ones edited on their own), missing dates get new events with the values of the prototype (earliest
     * future event of the series, else the latest one: name, times, zone, all-day, draft, location,
     * template, properties, features, target groups, duration), future events on other dates are deleted.
     * At most SeriesRule::MAX_EVENTS events in the series afterwards (422 `too_many_events`); a series that
     * would have no events → 422 `validation_failed` field `rule`; a series without events → 409
     * `series_empty`. One transaction with the series row locked: a database error changes nothing.
     */
    public function update(Calendar $calendar, string $id, array $data): array
    {
        try {
            return $this->em->wrapInTransaction(function () use ($calendar, $id, $data): array {
                // Serializes rule changes of the same series (the second one sees the result of the first)
                $locked = $this->em->getConnection()->fetchOne(
                    'SELECT id FROM event_series WHERE id = ? AND calendar_id = ? FOR UPDATE',
                    [strtolower($id), $calendar->getId()],
                );
                if (false === $locked) {
                    throw new NotFoundHttpException('Series not found');
                }
                $series = $this->findSeries($calendar, $id);
                $plan = $this->planUpdate($calendar, $series, $data);

                $this->quota->assertRoom(Quota::EVENTS_PER_CALENDAR, $calendar, count($plan['create']) - count($plan['delete']));
                $prototype = $this->em->find(Event::class, $plan['prototype']);
                if (null === $prototype) {
                    // Deleted between reading the events and loading it (a parallel request)
                    throw new ApiProblemException(409, 'The series changed meanwhile, please try again', self::SERIES_CHANGED_CODE);
                }
                $duration = null === $prototype->getDateEnd() ? 0 : (int) $prototype->getDate()->diff($prototype->getDateEnd())->days;
                foreach ($plan['create'] as $date) {
                    $this->copyEvent($prototype, $series, new \DateTimeImmutable($date), $duration);
                }
                if ([] !== $plan['delete']) {
                    // Assignments go with the events (ON DELETE CASCADE); already deleted ids are no error
                    $this->em->createQuery('DELETE FROM '.Event::class.' e WHERE e.id IN (:ids) AND e.series = :series')
                        ->setParameter('ids', array_column($plan['delete'], 'id'))
                        ->setParameter('series', $series->getId())
                        ->execute();
                    if (in_array($prototype->getId(), array_column($plan['delete'], 'id'), true)) {
                        $this->em->detach($prototype);
                    }
                }
                $series->changeRule($plan['rule']);
                $this->em->flush();

                return [
                    'series' => $this->events->serializeSeries($series, $plan['past'] + $plan['kept'] + count($plan['create'])),
                    'created' => count($plan['create']),
                    'deleted' => count($plan['delete']),
                    'kept' => $plan['kept'],
                ];
            });
        } catch (DeadlockException|LockWaitTimeoutException|ForeignKeyConstraintViolationException $e) {
            // A parallel change (e.g. a location or property of the prototype deleted meanwhile)
            throw new ApiProblemException(409, 'The series changed meanwhile, please try again', self::SERIES_CHANGED_CODE, null, [], $e);
        }
    }

    /**
     * What a rule change does now (see update()).
     *
     * @return array{rule: SeriesRule, create: list<string>, delete: list<array{id: string, date: string, name: string, isDraft: bool}>, kept: int, past: int, skipped: list<array{date: string, name: string}>, prototype: string}
     */
    private function planUpdate(Calendar $calendar, EventSeries $series, array $data): array
    {
        $current = $series->getRule();
        $rule = SeriesRule::fromInput($data['rule'] ?? null, $current->durationDays);

        $rows = $this->em->createQueryBuilder()
            ->select('e.id', 'e.date', 'e.name', 'e.isDraft')
            ->from(Event::class, 'e')
            ->where('e.series = :series')
            ->setParameter('series', $series->getId())
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC')
            ->addOrderBy('e.id', 'ASC')
            ->getQuery()
            ->getArrayResult();
        if ([] === $rows) {
            throw new ApiProblemException(409, 'The series has no events left', self::SERIES_EMPTY_CODE);
        }

        $today = $this->today($calendar);
        $computed = $this->compute($calendar, $rule);
        $wanted = [];
        foreach ($computed['dates'] as $date) {
            if ($date->format('Y-m-d') >= $today) {
                $wanted[$date->format('Y-m-d')] = true;
            }
        }

        $past = 0;
        $kept = 0;
        $delete = [];
        $covered = [];
        $prototype = null;
        foreach ($rows as $row) {
            $date = $row['date']->format('Y-m-d');
            if ($date < $today) {
                ++$past;
                continue;
            }
            $prototype ??= $row['id'];
            if (isset($wanted[$date])) {
                ++$kept;
                $covered[$date] = true;
            } else {
                $delete[] = ['id' => $row['id'], 'date' => $date, 'name' => $row['name'], 'isDraft' => $row['isDraft']];
            }
        }
        $prototype ??= $rows[array_key_last($rows)]['id'];
        $create = array_values(array_filter(array_keys($wanted), fn (string $d) => !isset($covered[$d])));

        $total = $past + $kept + count($create);
        if ($total > SeriesRule::MAX_EVENTS) {
            throw SeriesRule::tooMany();
        }
        if (0 === $total) {
            throw new ApiProblemException(422, 'The series would have no events', Input::CODE, 'rule');
        }

        return [
            'rule' => $rule,
            'create' => $create,
            'delete' => $delete,
            'kept' => $kept,
            'past' => $past,
            'skipped' => array_values(array_filter($computed['skipped'], fn (array $s) => $s['date'] >= $today)),
            'prototype' => $prototype,
        ];
    }

    /** New event of the series on `$date` with the values of `$prototype` (assignments without extra reads). */
    private function copyEvent(Event $prototype, EventSeries $series, \DateTimeImmutable $date, int $duration): void
    {
        $event = (new Event())
            ->setCalendar($prototype->getCalendar())
            ->setSeries($series)
            ->setTemplate($prototype->getTemplate())
            ->setLocation($prototype->getLocation())
            ->setName($prototype->getName())
            ->setTimezone($prototype->getTimezone())
            ->setDate($date)
            ->setDateEnd($duration > 0 ? $date->modify("+$duration days") : null)
            ->setTimeBegin($prototype->getTimeBegin())
            ->setTimeEnd($prototype->getTimeEnd())
            ->setIsAllDay($prototype->isAllDay())
            ->setIsDraft($prototype->isDraft());
        $this->em->persist($event);
        foreach ($prototype->getProperties() as $link) {
            $copy = (new EventProperty())->setEvent($event)->setProperty($link->getProperty());
            $this->em->persist($copy);
            $event->getProperties()->add($copy);
        }
        foreach ($prototype->getFeatures() as $link) {
            $copy = (new EventFeature())->setEvent($event)->setFeature($link->getFeature());
            $this->em->persist($copy);
            $event->getFeatures()->add($copy);
        }
        foreach ($prototype->getTargetGroups() as $link) {
            $copy = (new EventTargetGroup())->setEvent($event)->setTargetGroup($link->getTargetGroup());
            $this->em->persist($copy);
            $event->getTargetGroups()->add($copy);
        }
    }

    /** Today in the calendar's zone (calendar, else club; unknown zones fall back to UTC). */
    private function today(Calendar $calendar): string
    {
        $zone = $calendar->getTimezone() ?? $calendar->getClub()->getTimezone();
        try {
            $tz = new \DateTimeZone($zone);
        } catch (\Exception) {
            $tz = new \DateTimeZone('UTC');
        }

        return $this->clock->now()->setTimezone($tz)->format('Y-m-d');
    }

    private function findSeries(Calendar $calendar, string $id): EventSeries
    {
        $series = $this->em->getRepository(EventSeries::class)->find($id);
        if (null === $series || $series->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Series not found');
        }

        return $series;
    }

    private function eventInput(array $data): array
    {
        $event = $data['event'] ?? [];
        if (!is_array($event) || (array_is_list($event) && [] !== $event)) {
            throw Input::invalid('event', 'event must be an object');
        }

        return $event;
    }

    /** Errors of the event fields name their place in the body (`event.name`). */
    private function inEvent(ApiProblemException $e): ApiProblemException
    {
        $field = $e->getField();
        if (null === $field || str_starts_with($field, 'event.')) {
            return $e;
        }

        return new ApiProblemException($e->getStatusCode(), 'event.'.$e->getMessage(), $e->getErrorCode(), 'event.'.$field, [], $e);
    }

    /**
     * Dates to create, skipped holidays and all holidays on dates of the rule. An event is "on" a holiday
     * when any of its days (multi-day events: date … date + durationDays) overlaps one.
     *
     * @return array{dates: list<\DateTimeImmutable>, skipped: list<array{date: string, name: string}>, holidays: list<array{date: string, name: string}>}
     */
    private function compute(Calendar $calendar, SeriesRule $rule): array
    {
        $holidays = array_map(fn ($h) => [
            'name' => $h->getName(),
            'from' => $h->getDate()->format('Y-m-d'),
            'to' => ($h->getDateEnd() ?? $h->getDate())->format('Y-m-d'),
        ], $this->holidays->findByCalendar(
            $calendar->getId(),
            $rule->startDate,
            null === $rule->until ? null : $rule->endOf($rule->lastDay()),
        ));

        $dates = [];
        $skipped = [];
        $onHoliday = [];
        foreach ($rule->candidates() as $date) {
            $from = $date->format('Y-m-d');
            $to = $rule->endOf($date)->format('Y-m-d');
            $holiday = null;
            foreach ($holidays as $h) {
                if ($h['from'] <= $to && $h['to'] >= $from) {
                    $holiday = $h['name'];
                    break;
                }
            }
            if (null !== $holiday) {
                $onHoliday[] = ['date' => $from, 'name' => $holiday];
            }
            if (null !== $holiday && $rule->skipHolidays) {
                $skipped[] = ['date' => $from, 'name' => $holiday];
                // Holidays that cover (almost) every date of the rule must not keep the loop running
                if (count($skipped) > SeriesRule::MAX_EVENTS) {
                    throw SeriesRule::tooMany();
                }
                continue;
            }
            $dates[] = $date;
            if (count($dates) > SeriesRule::MAX_EVENTS) {
                throw SeriesRule::tooMany();
            }
            if (null !== $rule->count && count($dates) >= $rule->count) {
                break;
            }
        }

        return ['dates' => $dates, 'skipped' => $skipped, 'holidays' => $onHoliday];
    }
}
