<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventSeries;
use App\Entity\EventTemplate;
use App\Exception\ApiProblemException;
use App\Repository\HolidayEventRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Event series (design: EventSeries): preview of a rule and atomic creation of the series with all
 * its events. The dates come from SeriesRule; holidays come from the calendar's holiday calendars
 * (overlap like `…/holiday-events`). Editing and deleting with a scope: EventService.
 */
readonly class EventSeriesService
{
    public function __construct(
        private EntityManagerInterface $em,
        private EventService $events,
        private CalendarReferences $references,
        private HolidayEventRepository $holidays,
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
        $series = $this->em->getRepository(EventSeries::class)->find($id);
        if (null === $series || $series->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Series not found');
        }

        return $this->events->serializeSeries($series, $this->events->countSeriesEvents($series));
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
