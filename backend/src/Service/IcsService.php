<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Ics\EventFactory;
use App\Ics\IcsEvent;
use App\Ics\IcsLocation;
use Eluceo\iCal\Domain\Entity\Calendar;
use Eluceo\iCal\Domain\Entity\Event as ICalEvent;
use Eluceo\iCal\Domain\Entity\TimeZone as ICalTimeZone;
use Eluceo\iCal\Domain\Enum\EventStatus;
use Eluceo\iCal\Domain\ValueObject\Date as ICalDate;
use Eluceo\iCal\Domain\ValueObject\DateTime as ICalDateTime;
use Eluceo\iCal\Domain\ValueObject\GeographicPosition;
use Eluceo\iCal\Domain\ValueObject\Location as ICalLocation;
use Eluceo\iCal\Domain\ValueObject\MultiDay;
use Eluceo\iCal\Domain\ValueObject\SingleDay;
use Eluceo\iCal\Domain\ValueObject\TimeSpan;
use Eluceo\iCal\Domain\ValueObject\UniqueIdentifier;
use Eluceo\iCal\Presentation\Factory\CalendarFactory;

class IcsService
{
    /**
     * Part of the ETag of the public feed ICS: increase it with every change of the ICS output
     * (fields, formatting, VTIMEZONE handling, library upgrade that alters the text), otherwise
     * clients keep getting 304 for the old format.
     */
    public const FORMAT_VERSION = 1;

    /**
     * @param iterable<IcsEvent> $events published events of the feed
     */
    public function buildIcs(CalendarFeed $feed, Club $club, iterable $events): string
    {
        return $this->render($club, $events, false);
    }

    /**
     * ICS file of a calendar's events (member export). Drafts are marked STATUS:TENTATIVE.
     *
     * @param iterable<IcsEvent> $events
     */
    public function buildCalendarIcs(Club $club, iterable $events): string
    {
        return $this->render($club, $events, true);
    }

    /**
     * @param iterable<IcsEvent> $events
     */
    private function render(Club $club, iterable $events, bool $markDrafts): string
    {
        $calendar = new Calendar();

        /** @var array<string, array{\DateTimeImmutable, \DateTimeImmutable}> $zoneRanges */
        $zoneRanges = [];
        foreach ($events as $event) {
            $icalEvent = $this->buildEvent($event, $this->fallbackTimezone($event, $club), $zoneRanges);
            if ($markDrafts && $event->isDraft) {
                $icalEvent->setStatus(EventStatus::TENTATIVE());
            }
            $calendar->addEvent($icalEvent);
        }

        // RFC 5545 3.2.19: every TZID used needs a VTIMEZONE; without it strict clients (e.g. ical.js,
        // Outlook) read the times as floating local time of the reader.
        foreach ($zoneRanges as $tz => [$from, $until]) {
            $calendar->addTimeZone(ICalTimeZone::createFromPhpDateTimeZone(new \DateTimeZone($tz), $from->modify('-1 day'), $until->modify('+1 day')));
        }

        return (string) (new CalendarFactory(new EventFactory()))->createCalendar($calendar);
    }

    /**
     * Zone for events without a (valid) own zone: calendar, then club, then UTC. Values stored before
     * time zones were validated (e.g. Windows names from an Outlook import) must not break the feed.
     */
    private function fallbackTimezone(IcsEvent $event, Club $club): string
    {
        return Input::canonicalTimezone($event->calendarTimezone)
            ?? Input::canonicalTimezone($club->getTimezone())
            ?? 'UTC';
    }

    /**
     * @param array<string, array{\DateTimeImmutable, \DateTimeImmutable}> $zoneRanges time span per zone used (for VTIMEZONE)
     */
    private function buildEvent(IcsEvent $event, string $fallbackTimezone, array &$zoneRanges): ICalEvent
    {
        $tz = Input::canonicalTimezone($event->timezone) ?? $fallbackTimezone;
        $uid = new UniqueIdentifier('event-'.$event->id.'@club-calendar');

        $iconStr = implode(' ', $event->propertyIcons);
        $summary = $iconStr ? "$iconStr {$event->name}" : $event->name;

        $parts = [];
        if ([] !== $event->featureNames) {
            $parts[] = 'Zusatzangebote: '.implode(', ', $event->featureNames);
        }
        if ([] !== $event->targetGroupNames) {
            $parts[] = 'Gruppen: '.implode(', ', $event->targetGroupNames);
        }
        if (null !== $event->note && '' !== $event->note) {
            array_unshift($parts, $event->note);
        }
        $description = implode("\n", $parts);

        $icalEvent = new ICalEvent($uid);
        $icalEvent->setSummary($summary);
        if ($description) {
            $icalEvent->setDescription($description);
        }

        // Location
        $loc = $event->location;
        if ($loc) {
            $locationStr = $this->buildLocationStr($loc);
            if ($locationStr) {
                $iCalLocation = new ICalLocation($locationStr, $loc->name ?: $loc->street ?: $locationStr);
                if (null !== $loc->latitude && null !== $loc->longitude) {
                    try {
                        $iCalLocation = $iCalLocation->withGeographicPosition(
                            new GeographicPosition((float) $loc->latitude, (float) $loc->longitude),
                        );
                    } catch (\InvalidArgumentException) {
                        // coordinates outside the valid range: leave the position out instead of failing the feed
                    }
                }
                $icalEvent->setLocation($iCalLocation);
            }
        }

        $startDateStr = $event->date;
        $endDateStr = $event->dateEnd ?? $startDateStr;

        $start = $end = null;
        if (!$event->isAllDay) {
            // Timed: parse start and end in the event timezone (a stored invalid time falls back to all-day)
            try {
                $tzObj = new \DateTimeZone($tz);
                $start = new \DateTimeImmutable("$startDateStr {$event->timeBegin}", $tzObj);
                $end = new \DateTimeImmutable("$endDateStr {$event->timeEnd}", $tzObj);
            } catch (\Exception) {
                $start = $end = null;
            }
        }

        if (null === $start || null === $end) {
            // All-day: MultiDay takes the last day inclusive and writes DTEND as last day + 1
            // (RFC 5545: exclusive end), so the stored end date is passed as it is.
            $occurrence = $event->dateEnd
                ? new MultiDay(
                    new ICalDate(new \DateTimeImmutable($startDateStr)),
                    new ICalDate(new \DateTimeImmutable($endDateStr)),
                )
                : new SingleDay(new ICalDate(new \DateTimeImmutable($startDateStr)));

            $icalEvent->setOccurrence($occurrence);
        } else {
            [$from, $until] = $zoneRanges[$tz] ?? [$start, $end];
            $zoneRanges[$tz] = [min($from, $start), max($until, $end)];
            $icalEvent->setOccurrence(new TimeSpan(
                new ICalDateTime($start, true),
                new ICalDateTime($end, true),
            ));
        }

        return $icalEvent;
    }

    private function buildLocationStr(IcsLocation $loc): string
    {
        $parts = [];
        if ($loc->name) {
            $parts[] = $loc->name;
        }
        if ($loc->street) {
            $parts[] = $loc->street;
        }
        $city = array_filter([$loc->zip, $loc->city]);
        if ($city) {
            $parts[] = implode(' ', $city);
        }
        if ($loc->country) {
            $parts[] = $loc->country;
        }

        return implode(', ', $parts);
    }
}
