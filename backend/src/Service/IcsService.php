<?php

declare(strict_types=1);

namespace App\Service;

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
use Eluceo\iCal\Presentation\Factory\TimeZoneFactory;
use Psr\Log\LoggerInterface;

class IcsService
{
    /**
     * Part of the ETag of the public feed ICS: increase it with every change of the ICS output
     * (fields, formatting, VTIMEZONE handling, library upgrade that alters the text), otherwise
     * clients keep getting 304 for the old format.
     */
    public const FORMAT_VERSION = 4;

    private const END = "END:VCALENDAR\r\n";

    public function __construct(private readonly ?LoggerInterface $logger = null)
    {
    }

    /**
     * Feed ICS as a stream of text pieces (envelope, VEVENT blocks per chunk, VTIMEZONE blocks, end).
     *
     * @param iterable<list<IcsEvent>> $chunks published events of the feed, in output order
     *
     * @return \Generator<int, string>
     */
    public function streamFeedIcs(Club $club, iterable $chunks): \Generator
    {
        return $this->stream($this->clubTimezone($club), $chunks, false);
    }

    /**
     * Same as streamFeedIcs() for a club known only by its time zone (the personal subscription feed reads it
     * from a light query), with the calendar name shown by the client.
     *
     * @param iterable<list<IcsEvent>> $chunks
     *
     * @return \Generator<int, string>
     */
    public function streamFeedIcsForZone(string $timezone, iterable $chunks, ?string $calendarName = null): \Generator
    {
        return $this->stream(Input::canonicalTimezone($timezone) ?? 'UTC', $chunks, false, $calendarName);
    }

    /**
     * ICS of a calendar's events (member export), as a stream. Drafts are marked STATUS:TENTATIVE.
     *
     * @param iterable<list<IcsEvent>> $chunks
     *
     * @return \Generator<int, string>
     */
    public function streamCalendarIcs(Club $club, iterable $chunks): \Generator
    {
        return $this->stream($this->clubTimezone($club), $chunks, true);
    }

    /**
     * StreamedResponse callback: writes the pieces and flushes after each. The status is already sent when an
     * error happens mid-stream, so it is logged and the output simply ends (no END:VCALENDAR: the file is invalid).
     *
     * @param iterable<string> $pieces
     */
    public function outputCallback(iterable $pieces): \Closure
    {
        return function () use ($pieces): void {
            try {
                foreach ($pieces as $piece) {
                    echo $piece;
                    flush();
                }
            } catch (\Throwable $e) {
                $this->logger?->error('ICS stream aborted', ['exception' => $e]);
            }
        };
    }

    /** `X-WR-CALNAME:` line (RFC 5545 text escaping, folded at 75 octets without splitting a UTF-8 character). */
    private static function nameLine(string $name): string
    {
        $clean = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $name) ?? '');
        $text = 'X-WR-CALNAME:'.strtr($clean, ['\\' => '\\\\', ';' => '\\;', ',' => '\\,']);
        $out = '';
        $line = '';
        foreach (mb_str_split($text) as $ch) {
            if (strlen($line) + strlen($ch) > 75) {
                $out .= $line."\r\n";
                $line = ' ';
            }
            $line .= $ch;
        }

        return $out.$line."\r\n";
    }

    private function clubTimezone(Club $club): string
    {
        return Input::canonicalTimezone($club->getTimezone()) ?? 'UTC';
    }

    /**
     * The library renders envelope, events and VTIMEZONEs of a Calendar in this order (events first); the
     * pieces are rendered by the library itself and only concatenated here, one chunk at a time.
     * RFC 5545 3.2.19: every TZID used needs a VTIMEZONE; without it strict clients (e.g. ical.js, Outlook)
     * read the times as floating local time of the reader. The span per zone is collected while streaming.
     *
     * @param iterable<list<IcsEvent>> $chunks
     *
     * @return \Generator<int, string>
     */
    private function stream(string $clubTimezone, iterable $chunks, bool $markDrafts, ?string $calendarName = null): \Generator
    {
        $eventFactory = new EventFactory();
        $envelope = (string) (new CalendarFactory($eventFactory))->createCalendar(new Calendar());
        if (!str_ends_with($envelope, self::END)) {
            throw new \LogicException('Unexpected calendar envelope');
        }
        yield substr($envelope, 0, -strlen(self::END)).(null === $calendarName ? '' : self::nameLine($calendarName));

        /** @var array<string, array{\DateTimeImmutable, \DateTimeImmutable}> $zoneRanges */
        $zoneRanges = [];
        foreach ($chunks as $events) {
            $text = '';
            foreach ($events as $event) {
                $icalEvent = $this->buildEvent($event, $this->fallbackTimezone($event, $clubTimezone), $zoneRanges);
                if ($markDrafts && $event->isDraft) {
                    $icalEvent->setStatus(EventStatus::TENTATIVE());
                }
                $text .= (string) $eventFactory->createComponent($icalEvent);
            }
            if ('' !== $text) {
                yield $text;
            }
        }

        $timeZones = [];
        foreach ($zoneRanges as $tz => [$from, $until]) {
            $timeZones[] = ICalTimeZone::createFromPhpDateTimeZone(new \DateTimeZone($tz), $from->modify('-1 day'), $until->modify('+1 day'));
        }
        foreach ((new TimeZoneFactory())->createComponents($timeZones) as $component) {
            yield (string) $component;
        }

        yield self::END;
    }

    /**
     * Zone for events without a (valid) own zone: calendar, then club, then UTC. Values stored before
     * time zones were validated (e.g. Windows names from an Outlook import) must not break the feed.
     */
    private function fallbackTimezone(IcsEvent $event, string $clubTimezone): string
    {
        return Input::canonicalTimezone($event->calendarTimezone) ?? $clubTimezone;
    }

    /**
     * @param array<string, array{\DateTimeImmutable, \DateTimeImmutable}> $zoneRanges time span per zone used (for VTIMEZONE)
     */
    private function buildEvent(IcsEvent $event, string $fallbackTimezone, array &$zoneRanges): ICalEvent
    {
        $tz = Input::canonicalTimezone($event->timezone) ?? $fallbackTimezone;
        $uid = new UniqueIdentifier('event-'.$event->id.'@club-calendar');

        $iconStr = implode(' ', $event->propertyIcons);
        $summary = ('' !== $iconStr ? "$iconStr " : '').$event->name;
        if ([] !== $event->featureNames) {
            $summary .= ' ('.implode(', ', $event->featureNames).')';
        }

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
        // Legend for the emoji in the title (one line per distinct icon)
        $legend = [];
        foreach ($event->propertyIcons as $i => $icon) {
            $name = $event->propertyNames[$i] ?? '';
            if ('' !== $name) {
                $legend[] = "$icon $name";
            }
        }
        if ([] !== $legend) {
            $parts[] = "Besonderheiten:\n".implode("\n", $legend);
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

    /** One part per line, as Apple writes it: "Name\nStreet\nZIP City\nCountry"; empty parts are skipped. */
    private function buildLocationStr(IcsLocation $loc): string
    {
        $parts = [
            $this->oneLine($loc->name),
            $this->oneLine($loc->street),
            trim($this->oneLine($loc->zip).' '.$this->oneLine($loc->city)),
            $this->oneLine($loc->country),
        ];

        return implode("\n", array_filter($parts, fn (string $p) => '' !== $p));
    }

    /** User text without line breaks or control characters: only our own separator newline remains. */
    private function oneLine(?string $value): string
    {
        $clean = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string) $value) ?? preg_replace('/[\x00-\x1F\x7F]+/', ' ', (string) $value) ?? '';

        return trim($clean);
    }
}
