<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\Event;
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
     * @param Event[] $events published events of the feed
     */
    public function buildIcs(CalendarFeed $feed, Club $club, array $events): string
    {
        return $this->render($club, $events, false);
    }

    /**
     * ICS file of a calendar's events (member export). Drafts are marked STATUS:TENTATIVE.
     *
     * @param Event[] $events
     */
    public function buildCalendarIcs(Club $club, array $events): string
    {
        return $this->render($club, $events, true);
    }

    /**
     * @param Event[] $events
     */
    private function render(Club $club, array $events, bool $markDrafts): string
    {
        $calendar = new Calendar();

        /** @var array<string, array{\DateTimeImmutable, \DateTimeImmutable}> $zoneRanges */
        $zoneRanges = [];
        foreach ($events as $event) {
            $icalEvent = $this->buildEvent($event, $this->fallbackTimezone($event, $club), $zoneRanges);
            if ($markDrafts && $event->isDraft()) {
                $icalEvent->setStatus(EventStatus::TENTATIVE());
            }
            $calendar->addEvent($icalEvent);
        }

        // RFC 5545 3.2.19: every TZID used needs a VTIMEZONE; without it strict clients (e.g. ical.js,
        // Outlook) read the times as floating local time of the reader.
        foreach ($zoneRanges as $tz => [$from, $until]) {
            $calendar->addTimeZone(ICalTimeZone::createFromPhpDateTimeZone(new \DateTimeZone($tz), $from->modify('-1 day'), $until->modify('+1 day')));
        }

        $factory = new CalendarFactory();
        $component = $factory->createCalendar($calendar);
        $icsStr = (string) $component;

        // Inject X-APPLE-STRUCTURED-LOCATION after rendering
        foreach ($events as $event) {
            $loc = $event->getLocation();
            if (!$loc || null === $loc->getLatitude() || null === $loc->getLongitude()) {
                continue;
            }
            $uid = 'event-'.$event->getId().'@club-calendar';
            $xAppleLine = $this->buildXAppleLine($loc);
            if ($xAppleLine) {
                $icsStr = preg_replace(
                    '/(UID:'.preg_quote($uid, '/').'[\s\S]*?)(\r?\nEND:VEVENT)/',
                    '$1'."\r\n".$xAppleLine.'$2',
                    $icsStr,
                );
            }
        }

        return $icsStr;
    }

    /**
     * Zone for events without a (valid) own zone: calendar, then club, then UTC. Values stored before
     * time zones were validated (e.g. Windows names from an Outlook import) must not break the feed.
     */
    private function fallbackTimezone(Event $event, Club $club): string
    {
        return Input::canonicalTimezone($event->getCalendar()->getTimezone())
            ?? Input::canonicalTimezone($club->getTimezone())
            ?? 'UTC';
    }

    /**
     * @param array<string, array{\DateTimeImmutable, \DateTimeImmutable}> $zoneRanges time span per zone used (for VTIMEZONE)
     */
    private function buildEvent(Event $event, string $fallbackTimezone, array &$zoneRanges): ICalEvent
    {
        $tz = Input::canonicalTimezone($event->getTimezone()) ?? $fallbackTimezone;
        $uid = new UniqueIdentifier('event-'.$event->getId().'@club-calendar');

        // Build summary: icons + name
        $icons = array_filter(array_map(
            fn ($ep) => $ep->getProperty()->getIcon(),
            $event->getProperties()->toArray(),
        ));
        $iconStr = implode(' ', $icons);
        $summary = $iconStr ? "$iconStr {$event->getName()}" : $event->getName();

        // Build description
        $parts = [];
        if ($event->getFeatures()->count() > 0) {
            $names = array_map(fn ($ef) => $ef->getFeature()->getName(), $event->getFeatures()->toArray());
            $parts[] = 'Features: '.implode(', ', $names);
        }
        if ($event->getTargetGroups()->count() > 0) {
            $names = array_map(fn ($etg) => $etg->getTargetGroup()->getName(), $event->getTargetGroups()->toArray());
            $parts[] = 'Zielgruppen: '.implode(', ', $names);
        }
        $description = implode("\n", $parts);

        $icalEvent = new ICalEvent($uid);
        $icalEvent->setSummary($summary);
        if ($description) {
            $icalEvent->setDescription($description);
        }

        // Location
        $loc = $event->getLocation();
        if ($loc) {
            $locationStr = $this->buildLocationStr($loc);
            if ($locationStr) {
                $iCalLocation = new ICalLocation($locationStr);
                if (null !== $loc->getLatitude() && null !== $loc->getLongitude()) {
                    $iCalLocation = $iCalLocation->withGeographicPosition(
                        new GeographicPosition((float) $loc->getLatitude(), (float) $loc->getLongitude()),
                    );
                }
                $icalEvent->setLocation($iCalLocation);
            }
        }

        $startDateStr = $event->getDate()->format('Y-m-d');
        $endDateStr = $event->getDateEnd() ? $event->getDateEnd()->format('Y-m-d') : $startDateStr;

        $start = $end = null;
        if (!$event->isAllDay()) {
            // Timed: parse start and end in the event timezone (a stored invalid time falls back to all-day)
            try {
                $tzObj = new \DateTimeZone($tz);
                $start = new \DateTimeImmutable("$startDateStr {$event->getTimeBegin()}", $tzObj);
                $end = new \DateTimeImmutable("$endDateStr {$event->getTimeEnd()}", $tzObj);
            } catch (\Exception) {
                $start = $end = null;
            }
        }

        if (null === $start || null === $end) {
            // All-day: MultiDay takes the last day inclusive and writes DTEND as last day + 1
            // (RFC 5545: exclusive end), so the stored end date is passed as it is.
            $occurrence = $event->getDateEnd()
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

    private function buildLocationStr(\App\Entity\Location $loc): string
    {
        $parts = [];
        if ($loc->getName()) {
            $parts[] = $loc->getName();
        }
        if ($loc->getStreet()) {
            $parts[] = $loc->getStreet();
        }
        $city = array_filter([$loc->getZip(), $loc->getCity()]);
        if ($city) {
            $parts[] = implode(' ', $city);
        }
        if ($loc->getCountry()) {
            $parts[] = $loc->getCountry();
        }

        return implode(', ', $parts);
    }

    private function buildXAppleLine(\App\Entity\Location $loc): string
    {
        if (null === $loc->getLatitude() || null === $loc->getLongitude()) {
            return '';
        }
        $addrParts = [];
        if ($loc->getStreet()) {
            $addrParts[] = $loc->getStreet();
        }
        $city = array_filter([$loc->getZip(), $loc->getCity()]);
        if ($city) {
            $addrParts[] = implode(' ', $city);
        }
        if ($loc->getCountry()) {
            $addrParts[] = $loc->getCountry();
        }
        $xAddress = implode('\\n', $addrParts);
        $xTitle = $loc->getName() ?? ($addrParts[0] ?? '');
        $params = ['VALUE=URI'];
        if ($xTitle) {
            $params[] = 'X-TITLE="'.$xTitle.'"';
        }
        if ($xAddress) {
            $params[] = 'X-ADDRESS="'.$xAddress.'"';
        }
        $params[] = 'X-APPLE-RADIUS=100';

        return 'X-APPLE-STRUCTURED-LOCATION;'.implode(';', $params).':geo:'.$loc->getLatitude().','.$loc->getLongitude();
    }
}
