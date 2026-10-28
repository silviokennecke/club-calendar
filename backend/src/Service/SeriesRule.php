<?php

declare(strict_types=1);

namespace App\Service;

use App\Exception\ApiProblemException;

/**
 * Recurrence rule of an event series (design: EventSeries) and the only place that computes its
 * dates (the frontend shows the server's preview). Date arithmetic is in whole calendar days in UTC,
 * so daylight saving changes never shift a day; the events keep their wall-clock times.
 *
 * - `weekly`: every `weekday` from `startDate` (the start day counts when it is that weekday)
 * - `biweekly`: every second `weekday`, counted from the first match
 * - `monthly`: the `nth` (1–4, 5 = last) `weekday` of every month, from `startDate`
 * - end: `until` (inclusive) OR `count` (number of created events, holidays skipped do not count)
 */
final readonly class SeriesRule
{
    public const FREQUENCIES = ['weekly', 'biweekly', 'monthly'];

    /** Most events per series (one per day for a year); more → 422 `too_many_events`. */
    public const MAX_EVENTS = 366;

    /** Longest event of a series in extra days (`durationDays`). */
    public const MAX_DURATION_DAYS = 31;

    public const MAX_HOLIDAY_CALENDARS = 20;

    public function __construct(
        public string $frequency,
        public int $weekday,
        public ?int $nth,
        public \DateTimeImmutable $startDate,
        public ?\DateTimeImmutable $until,
        public ?int $count,
        public bool $skipHolidays,
        public int $durationDays = 0,
        /** @var list<string>|null holiday calendars considered (null = all of the calendar) */
        public ?array $holidayCalendarIds = null,
    ) {
    }

    /**
     * Validates a rule from a request body. Errors: 400 `validation_failed` with `rule.<field>`
     * (`rule` when both or neither of `until`/`count` are set), a `count` above MAX_EVENTS 422 `too_many_events`.
     */
    public static function fromInput(mixed $rule, mixed $durationDays = null): self
    {
        if (!is_array($rule) || array_is_list($rule) && [] !== $rule) {
            throw Input::invalid('rule', 'rule must be an object');
        }
        $frequency = $rule['frequency'] ?? null;
        if (!is_string($frequency) || !in_array($frequency, self::FREQUENCIES, true)) {
            throw Input::invalid('rule.frequency', 'rule.frequency must be one of: '.implode(', ', self::FREQUENCIES));
        }
        $weekday = $rule['weekday'] ?? null;
        if (!is_int($weekday) || $weekday < 0 || $weekday > 6) {
            throw Input::invalid('rule.weekday', 'rule.weekday must be 0 (Sunday) … 6 (Saturday)');
        }
        $nth = null;
        if ('monthly' === $frequency) {
            $nth = $rule['nth'] ?? null;
            if (!is_int($nth) || $nth < 1 || $nth > 5) {
                throw Input::invalid('rule.nth', 'rule.nth must be 1–4 or 5 (last) for a monthly rule');
            }
        }
        $start = self::utc(Input::parseDate($rule['startDate'] ?? null, 'rule.startDate'));

        $hasUntil = null !== ($rule['until'] ?? null);
        $hasCount = null !== ($rule['count'] ?? null);
        if ($hasUntil === $hasCount) {
            throw Input::invalid('rule', 'rule needs exactly one of until (date) or count');
        }
        $until = null;
        $count = null;
        if ($hasUntil) {
            $until = self::utc(Input::parseDate($rule['until'], 'rule.until'));
            if ($until < $start) {
                throw Input::invalid('rule.until', 'rule.until must not be before rule.startDate');
            }
        } else {
            $count = $rule['count'];
            if (!is_int($count) || $count < 1) {
                throw Input::invalid('rule.count', 'rule.count must be a positive number');
            }
            if ($count > self::MAX_EVENTS) {
                throw self::tooMany('rule.count');
            }
        }

        $skip = $rule['skipHolidays'] ?? false;
        if (!is_bool($skip)) {
            throw Input::invalid('rule.skipHolidays', 'rule.skipHolidays must be a boolean');
        }

        $holidayCalendarIds = null;
        if (null !== ($rule['holidayCalendarIds'] ?? null)) {
            $raw = $rule['holidayCalendarIds'];
            if (!is_array($raw) || !array_is_list($raw)) {
                throw Input::invalid('rule.holidayCalendarIds', 'rule.holidayCalendarIds must be a list of ids');
            }
            foreach ($raw as $id) {
                if (!is_string($id) || '' === $id) {
                    throw Input::invalid('rule.holidayCalendarIds', 'rule.holidayCalendarIds must be a list of ids');
                }
            }
            $holidayCalendarIds = array_values(array_unique(array_map('strtolower', $raw)));
            if (count($holidayCalendarIds) > self::MAX_HOLIDAY_CALENDARS) {
                throw Input::invalid('rule.holidayCalendarIds', sprintf('rule.holidayCalendarIds must not have more than %d ids', self::MAX_HOLIDAY_CALENDARS));
            }
        }

        $durationDays ??= 0;
        if (!is_int($durationDays) || $durationDays < 0 || $durationDays > self::MAX_DURATION_DAYS) {
            throw Input::invalid('event.durationDays', sprintf('event.durationDays must be 0–%d', self::MAX_DURATION_DAYS));
        }

        return new self($frequency, $weekday, $nth, $start, $until, $count, $skip, $durationDays, $holidayCalendarIds);
    }

    public static function tooMany(string $field = 'rule'): ApiProblemException
    {
        return new ApiProblemException(422, sprintf('A series has at most %d events', self::MAX_EVENTS), EventImportService::TOO_MANY_CODE, $field);
    }

    /**
     * Dates the rule produces, in order, before holidays are taken into account. Ends after `until`,
     * or with the last event that still ends by 9999-12-31 (the last day the database stores); with
     * `count` the caller stops once enough events are kept.
     *
     * @return \Generator<\DateTimeImmutable>
     */
    public function candidates(): \Generator
    {
        $last = $this->lastDay();
        if ('monthly' === $this->frequency) {
            $month = $this->startDate->modify('first day of this month');
            while (true) {
                $date = $this->nthWeekdayOf($month);
                if ($date >= $this->startDate) {
                    if ($date > $last) {
                        return;
                    }
                    yield $date;
                }
                $month = $month->modify('first day of next month');
            }
        }

        $offset = ($this->weekday - (int) $this->startDate->format('w') + 7) % 7;
        $step = 'biweekly' === $this->frequency ? 14 : 7;
        for ($date = $this->startDate->modify("+$offset days"); $date <= $last; $date = $date->modify("+$step days")) {
            yield $date;
        }
    }

    /** Last start day: `until`, but never so late that an event ends after 9999-12-31. */
    public function lastDay(): \DateTimeImmutable
    {
        $max = new \DateTimeImmutable('9999-12-31', new \DateTimeZone('UTC'));
        if ($this->durationDays > 0) {
            $max = $max->modify("-{$this->durationDays} days");
        }

        return null !== $this->until && $this->until < $max ? $this->until : $max;
    }

    /** The n-th (5: last) weekday of the month that `$firstOfMonth` starts. */
    private function nthWeekdayOf(\DateTimeImmutable $firstOfMonth): \DateTimeImmutable
    {
        $first = 1 + ($this->weekday - (int) $firstOfMonth->format('w') + 7) % 7;
        $daysInMonth = (int) $firstOfMonth->format('t');
        $day = 5 === $this->nth
            ? $first + 7 * intdiv($daysInMonth - $first, 7)
            : $first + 7 * ((int) $this->nth - 1);

        return $firstOfMonth->setDate((int) $firstOfMonth->format('Y'), (int) $firstOfMonth->format('n'), $day);
    }

    /** Last day of an event starting on `$date`. */
    public function endOf(\DateTimeImmutable $date): \DateTimeImmutable
    {
        return 0 === $this->durationDays ? $date : $date->modify("+{$this->durationDays} days");
    }

    /** @return array{frequency: string, weekday: int, nth: int|null, startDate: string, until: string|null, count: int|null, skipHolidays: bool, durationDays: int, holidayCalendarIds: list<string>|null} */
    public function toArray(): array
    {
        return [
            'frequency' => $this->frequency,
            'weekday' => $this->weekday,
            'nth' => $this->nth,
            'startDate' => $this->startDate->format('Y-m-d'),
            'until' => $this->until?->format('Y-m-d'),
            'count' => $this->count,
            'skipHolidays' => $this->skipHolidays,
            'durationDays' => $this->durationDays,
            'holidayCalendarIds' => $this->holidayCalendarIds,
        ];
    }

    private static function utc(\DateTimeImmutable $date): \DateTimeImmutable
    {
        return new \DateTimeImmutable($date->format('Y-m-d'), new \DateTimeZone('UTC'));
    }
}
