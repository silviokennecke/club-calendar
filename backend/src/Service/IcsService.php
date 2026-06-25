<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\Event;
use Eluceo\iCal\Domain\Entity\Calendar;
use Eluceo\iCal\Domain\Entity\Event as ICalEvent;
use Eluceo\iCal\Domain\ValueObject\DateTime as ICalDateTime;
use Eluceo\iCal\Domain\ValueObject\Date as ICalDate;
use Eluceo\iCal\Domain\ValueObject\MultiDay;
use Eluceo\iCal\Domain\ValueObject\SingleDay;
use Eluceo\iCal\Domain\ValueObject\TimeSpan;
use Eluceo\iCal\Domain\ValueObject\Location as ICalLocation;
use Eluceo\iCal\Domain\ValueObject\GeographicPosition;
use Eluceo\iCal\Domain\ValueObject\UniqueIdentifier;
use Eluceo\iCal\Presentation\Factory\CalendarFactory;

class IcsService
{
    public function buildIcs(CalendarFeed $feed, Club $club, array $events): string
    {
        $calendar = new Calendar();

        foreach ($events as $event) {
            $icalEvent = $this->buildEvent($event, $club->getTimezone());
            $calendar->addEvent($icalEvent);
        }

        $factory   = new CalendarFactory();
        $component = $factory->createCalendar($calendar);
        $icsStr    = (string) $component;

        // Inject X-APPLE-STRUCTURED-LOCATION after rendering
        foreach ($events as $event) {
            $loc = $event->getLocation();
            if (!$loc || $loc->getLatitude() === null || $loc->getLongitude() === null) {
                continue;
            }
            $uid = 'event-' . $event->getId() . '@club-calendar';
            $xAppleLine = $this->buildXAppleLine($loc);
            if ($xAppleLine) {
                $icsStr = preg_replace(
                    '/(UID:' . preg_quote($uid, '/') . '[\s\S]*?)(\r?\nEND:VEVENT)/',
                    '$1' . "\r\n" . $xAppleLine . '$2',
                    $icsStr,
                );
            }
        }

        return $icsStr;
    }

    private function buildEvent(Event $event, string $clubTimezone): ICalEvent
    {
        $tz = $event->getTimezone() ?? $clubTimezone;
        $uid = new UniqueIdentifier('event-' . $event->getId() . '@club-calendar');

        // Build summary: icons + name
        $icons = array_filter(array_map(
            fn ($ep) => $ep->getProperty()->getIcon(),
            $event->getProperties()->toArray()
        ));
        $iconStr = implode(' ', $icons);
        $summary = $iconStr ? "$iconStr {$event->getName()}" : $event->getName();

        // Build description
        $parts = [];
        if ($event->getFeatures()->count() > 0) {
            $names   = array_map(fn ($ef) => $ef->getFeature()->getName(), $event->getFeatures()->toArray());
            $parts[] = 'Features: ' . implode(', ', $names);
        }
        if ($event->getTargetGroups()->count() > 0) {
            $names   = array_map(fn ($etg) => $etg->getTargetGroup()->getName(), $event->getTargetGroups()->toArray());
            $parts[] = 'Zielgruppen: ' . implode(', ', $names);
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
                if ($loc->getLatitude() !== null && $loc->getLongitude() !== null) {
                    $iCalLocation = $iCalLocation->withGeographicPosition(
                        new GeographicPosition((float) $loc->getLatitude(), (float) $loc->getLongitude())
                    );
                }
                $icalEvent->setLocation($iCalLocation);
            }
        }

        $startDateStr = $event->getDate()->format('Y-m-d');
        $endDateStr   = $event->getDateEnd() ? $event->getDateEnd()->format('Y-m-d') : $startDateStr;

        if ($event->isAllDay()) {
            // All-day: end date is exclusive (add 1 day)
            $endDate = new \DateTimeImmutable($endDateStr);
            $endDate = $endDate->modify('+1 day');

            $occurrence = $event->getDateEnd()
                ? new MultiDay(
                    new ICalDate(new \DateTimeImmutable($startDateStr)),
                    new ICalDate($endDate),
                )
                : new SingleDay(new ICalDate(new \DateTimeImmutable($startDateStr)));

            $icalEvent->setOccurrence($occurrence);
        } else {
            // Timed: parse start and end in the event timezone
            $tzObj = new \DateTimeZone($tz);
            $start = new \DateTimeImmutable("$startDateStr {$event->getTimeBegin()}", $tzObj);
            $end   = new \DateTimeImmutable("$endDateStr {$event->getTimeEnd()}", $tzObj);

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
        if ($loc->getLatitude() === null || $loc->getLongitude() === null) {
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
        $xTitle   = $loc->getName() ?? ($addrParts[0] ?? '');
        $params   = ['VALUE=URI'];
        if ($xTitle) {
            $params[] = 'X-TITLE="' . $xTitle . '"';
        }
        if ($xAddress) {
            $params[] = 'X-ADDRESS="' . $xAddress . '"';
        }
        $params[] = 'X-APPLE-RADIUS=100';

        return 'X-APPLE-STRUCTURED-LOCATION;' . implode(';', $params) . ':geo:' . $loc->getLatitude() . ',' . $loc->getLongitude();
    }
}
