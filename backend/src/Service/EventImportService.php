<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * ICS import (the file is parsed in the browser; the API gets the reviewed events as JSON):
 *
 * - preview(): status per entry (`new` | `duplicate` | `invalid`) with the same validation as the import,
 *   writes nothing;
 * - import(): all or nothing in one transaction, optionally with new places (`locations` with a `tempId`
 *   that events reference as `locationTempId`; only places an imported event uses are created) and
 *   `skipDuplicates`.
 *
 * Duplicates are events the calendar already has: same `externalUid` (ICS UID; also the UID our own ICS
 * export writes, `event-<id>@club-calendar`), else same name and start date. Names compare like
 * UniqueNames (trim, case-insensitive) and without leading property icons (our export writes "🎯 Training").
 * Entries of the same request are not compared with each other (exceptions of an ICS series share a UID).
 *
 * Unknown or outdated time zones (e.g. "US/Pacific-New", Windows names) fall back to the calendar's zone
 * (else the club's, else none) and are reported in `warnings` instead of failing the import.
 */
readonly class EventImportService
{
    /** Most events (and new places) per request; more → 413 `too_many_events`. */
    public const MAX_EVENTS = 5000;
    public const TOO_MANY_CODE = 'too_many_events';
    public const TIMEZONE_REPLACED = 'timezone_replaced';
    /** Longest `locations[].tempId`. */
    public const MAX_TEMP_ID = 1000;

    private const OWN_UID = '/^event-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@club-calendar$/i';
    private const LEADING_ICONS = '/^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]|\x{200D}|\x{FE0F}|\s)+/u';

    public function __construct(
        private EntityManagerInterface $em,
        private EventService $events,
        private LocationService $locations,
    ) {
    }

    /**
     * @return array{events: list<array<string, mixed>>, summary: array{total: int, new: int, duplicate: int, invalid: int}, warnings: list<array<string, mixed>>}
     */
    public function preview(Calendar $calendar, array $body): array
    {
        $input = $this->parseBody($body);
        $this->preloadReferences($calendar);
        $existing = $this->existingIndex($calendar);
        $places = $this->buildLocations($calendar, $input['locations']);

        $rows = [];
        $warnings = [];
        $summary = ['total' => count($input['events']), 'new' => 0, 'duplicate' => 0, 'invalid' => 0];
        foreach ($input['events'] as $i => $data) {
            try {
                $entry = $this->prepare($calendar, $data, $i, $places);
                $this->events->buildEvent($calendar, $entry['data'], true);
            } catch (HttpException $e) {
                $error = $this->entryError($e, $i);
                $rows[] = ['index' => $i, 'status' => 'invalid', 'errors' => [[
                    'field' => $error->getField(),
                    'code' => $error->getErrorCode(),
                    'message' => $error->getMessage(),
                ]]];
                ++$summary['invalid'];
                continue;
            }
            array_push($warnings, ...$entry['warnings']);
            $duplicate = $this->findDuplicate($existing, $entry['externalUid'], $entry['data']);
            if (null !== $duplicate) {
                $rows[] = ['index' => $i, 'status' => 'duplicate', 'duplicate' => $duplicate];
                ++$summary['duplicate'];
            } else {
                $rows[] = ['index' => $i, 'status' => 'new'];
                ++$summary['new'];
            }
        }

        return ['events' => $rows, 'summary' => $summary, 'warnings' => $warnings];
    }

    /**
     * @return array{imported: int, skipped: int, createdLocations: list<array{tempId: string, id: string}>, ids: list<string>, warnings: list<array<string, mixed>>}
     */
    public function import(Calendar $calendar, array $body): array
    {
        $input = $this->parseBody($body);
        $this->preloadReferences($calendar);
        $existing = $input['skipDuplicates'] ? $this->existingIndex($calendar) : null;
        $places = $this->buildLocations($calendar, $input['locations']);

        // Everything is validated and persisted first; nothing reaches the database before the single
        // flush below, so a failing entry leaves no trace (no places, no earlier events).
        $ids = [];
        $used = [];
        $skipped = 0;
        $warnings = [];
        foreach ($input['events'] as $i => $data) {
            try {
                $entry = $this->prepare($calendar, $data, $i, $places);
                $skip = null !== $existing && null !== $this->findDuplicate($existing, $entry['externalUid'], $entry['data']);
                // Skipped duplicates are still validated: an invalid entry fails the import like in the preview.
                $event = $this->events->buildEvent($calendar, $entry['data'], $skip);
            } catch (HttpException $e) {
                throw $this->entryError($e, $i);
            }
            array_push($warnings, ...$entry['warnings']);
            if ($skip) {
                ++$skipped;
                continue;
            }
            $event->setExternalUid($entry['externalUid']);
            if (null !== $entry['location']) {
                $event->setLocation($entry['location']);
                $used[spl_object_id($entry['location'])] = true;
            }
            $ids[] = $event->getId();
        }

        // New places are only created for imported events (not for unused or only skipped ones)
        $created = [];
        foreach ($places as $tempId => $location) {
            if (isset($used[spl_object_id($location)])) {
                $this->em->persist($location);
                $created[] = ['tempId' => (string) $tempId, 'id' => $location->getId()];
            }
        }

        // One flush in one transaction: places and events are stored together or not at all
        $this->em->wrapInTransaction(fn () => $this->em->flush());

        return ['imported' => count($ids), 'skipped' => $skipped, 'createdLocations' => $created, 'ids' => $ids, 'warnings' => $warnings];
    }

    /**
     * @return array{events: list<mixed>, locations: list<mixed>, skipDuplicates: bool}
     */
    private function parseBody(array $body): array
    {
        $events = $body['events'] ?? null;
        if (!is_array($events) || [] === $events || !array_is_list($events)) {
            throw Input::invalid('events', 'events array required');
        }
        if (count($events) > self::MAX_EVENTS) {
            throw new ApiProblemException(413, sprintf('Maximum %d events per import', self::MAX_EVENTS), self::TOO_MANY_CODE, 'events');
        }
        $locations = $body['locations'] ?? [];
        if (!is_array($locations) || !array_is_list($locations)) {
            throw Input::invalid('locations', 'locations must be a list');
        }
        if (count($locations) > self::MAX_EVENTS) {
            throw new ApiProblemException(413, sprintf('Maximum %d locations per import', self::MAX_EVENTS), self::TOO_MANY_CODE, 'locations');
        }
        $skip = $body['skipDuplicates'] ?? false;
        if (!is_bool($skip)) {
            throw Input::invalid('skipDuplicates', 'skipDuplicates must be a boolean');
        }

        return ['events' => $events, 'locations' => $locations, 'skipDuplicates' => $skip];
    }

    /**
     * New places of the request by tempId (validated like `POST …/locations`, not persisted).
     *
     * @return array<string, Location>
     */
    private function buildLocations(Calendar $calendar, array $locations): array
    {
        $places = [];
        foreach ($locations as $n => $data) {
            try {
                if (!is_array($data)) {
                    throw Input::invalid('', 'location must be an object');
                }
                // Room for keys derived from the place name (the frontend sends "new:<normalized name>",
                // names have up to 255 characters, lower-casing can lengthen them)
                $tempId = Input::string($data, 'tempId', self::MAX_TEMP_ID);
                if (isset($places[$tempId])) {
                    throw Input::invalid('tempId', sprintf('tempId "%s" is used twice', $tempId));
                }
                $places[$tempId] = $this->locations->build($calendar, $data);
            } catch (HttpException $e) {
                throw $this->prefixed($e, sprintf('locations[%d]', $n));
            }
        }

        return $places;
    }

    /**
     * Request data of one entry for EventService::buildEvent, with its place, UID and warnings.
     *
     * @param array<string, Location> $places
     *
     * @return array{data: array<string, mixed>, externalUid: ?string, location: ?Location, warnings: list<array<string, mixed>>}
     */
    private function prepare(Calendar $calendar, mixed $data, int $index, array $places): array
    {
        if (!is_array($data) || array_is_list($data)) {
            throw Input::invalid('', 'event must be an object');
        }
        $uid = Input::nullableString($data, 'externalUid');
        $uid = null === $uid || '' === trim($uid) ? null : trim($uid);

        $location = null;
        $tempId = $data['locationTempId'] ?? null;
        if (null !== $tempId) {
            if (!is_string($tempId) || '' === $tempId) {
                throw Input::invalid('locationTempId', 'locationTempId must be a string');
            }
            if (null !== ($data['locationId'] ?? null) && '' !== $data['locationId']) {
                throw Input::invalid('locationTempId', 'locationId and locationTempId must not both be set');
            }
            $location = $places[$tempId] ?? throw CalendarReferences::unknown('locationTempId', $tempId);
            $data['locationId'] = null;
        }

        $warnings = [];
        $timezone = $data['timezone'] ?? null;
        if (is_string($timezone) && '' !== $timezone && !Input::isValidTimezone($timezone)) {
            $fallback = Input::canonicalTimezone($calendar->getTimezone()) ?? Input::canonicalTimezone($calendar->getClub()->getTimezone());
            $data['timezone'] = $fallback;
            $warnings[] = [
                'index' => $index,
                'field' => 'timezone',
                'code' => self::TIMEZONE_REPLACED,
                'message' => sprintf('Unknown time zone "%s" replaced by %s', mb_substr($timezone, 0, 100), $fallback ?? 'the calendar time zone'),
                'value' => mb_substr($timezone, 0, 100),
                'replacement' => $fallback,
            ];
        } elseif ('' === $timezone) {
            $data['timezone'] = null;
        }

        return ['data' => $data, 'externalUid' => $uid, 'location' => $location, 'warnings' => $warnings];
    }

    /** The error of entry `$index` as `events[n]: …` with `field: events[n].<field>` (nothing is stored). */
    private function entryError(HttpException $e, int $index): ApiProblemException
    {
        return $this->prefixed($e, sprintf('events[%d]', $index));
    }

    private function prefixed(HttpException $e, string $prefix): ApiProblemException
    {
        $field = $e instanceof ApiProblemException ? (string) $e->getField() : '';
        $code = $e instanceof ApiProblemException ? $e->getErrorCode() : Input::CODE;

        return new ApiProblemException(
            $e->getStatusCode(),
            sprintf('%s: %s', $prefix, $e->getMessage()),
            $code,
            '' === $field ? $prefix : $prefix.'.'.$field,
            [],
            $e,
        );
    }

    /**
     * Loads the calendar's reference data once, so that resolving the ids of thousands of entries hits
     * Doctrine's identity map instead of running one query per entry.
     */
    private function preloadReferences(Calendar $calendar): void
    {
        foreach ([Location::class, Property::class, Feature::class, TargetGroup::class, EventTemplate::class] as $class) {
            $this->em->getRepository($class)->findBy(['calendar' => $calendar]);
        }
    }

    /**
     * The calendar's events for the duplicate check (one query).
     *
     * @return array{byId: array<string, array{id: string, name: string, date: string}>, byUid: array<string, list<array{id: string, name: string, date: string}>>, byNameDate: array<string, array{id: string, name: string, date: string}>}
     */
    private function existingIndex(Calendar $calendar): array
    {
        $rows = $this->em->createQueryBuilder()
            ->select('e.id', 'e.name', 'e.date', 'e.externalUid')
            ->from(Event::class, 'e')
            ->where('e.calendar = :calendar')
            ->setParameter('calendar', $calendar)
            ->orderBy('e.date', 'ASC')
            ->getQuery()
            ->getArrayResult();

        $index = ['byId' => [], 'byUid' => [], 'byNameDate' => []];
        foreach ($rows as $row) {
            $event = ['id' => (string) $row['id'], 'name' => (string) $row['name'], 'date' => $row['date']->format('Y-m-d')];
            $index['byId'][strtolower($event['id'])] = $event;
            if (null !== $row['externalUid'] && '' !== $row['externalUid']) {
                $index['byUid'][(string) $row['externalUid']][] = $event;
            }
            $index['byNameDate'][self::nameKey($event['name']).'|'.$event['date']] ??= $event;
        }

        return $index;
    }

    /**
     * @return array{id: string, name: string, date: string, rule: string}|null
     */
    private function findDuplicate(array $existing, ?string $uid, array $data): ?array
    {
        $date = is_string($data['date'] ?? null) ? $data['date'] : '';
        if (null !== $uid) {
            if (preg_match(self::OWN_UID, $uid, $m) && isset($existing['byId'][strtolower($m[1])])) {
                return $existing['byId'][strtolower($m[1])] + ['rule' => 'externalUid'];
            }
            $sameUid = $existing['byUid'][$uid] ?? [];
            if ([] !== $sameUid) {
                // Prefer the event on the same day (exceptions of a series share their UID)
                $match = array_values(array_filter($sameUid, fn (array $e) => $e['date'] === $date))[0] ?? $sameUid[0];

                return $match + ['rule' => 'externalUid'];
            }
        }
        if (is_string($data['name'] ?? null) && '' !== $date) {
            $match = $existing['byNameDate'][self::nameKey($data['name']).'|'.$date] ?? null;
            if (null !== $match) {
                return $match + ['rule' => 'nameDate'];
            }
        }

        return null;
    }

    /** Name for the duplicate check: without leading icons, trimmed, lower case (see UniqueNames). */
    public static function nameKey(string $name): string
    {
        $stripped = preg_replace(self::LEADING_ICONS, '', $name);
        if (null === $stripped || '' === UniqueNames::normalize($stripped)) {
            $stripped = $name;
        }

        return UniqueNames::normalize($stripped);
    }
}
