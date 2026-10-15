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
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Exception\ApiProblemException;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class EventService
{
    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
    ) {
    }

    /** $from / $to: days of the overlap filter, already validated (Input::optionalDate). */
    public function listEvents(Calendar $calendar, ?\DateTimeImmutable $from, ?\DateTimeImmutable $to, ?array $targetGroupIds): array
    {
        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->where('e.calendar = :calendar')
            ->setParameter('calendar', $calendar)
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC');

        if (null !== $from) {
            // Overlap: multi-day events that started before the range but reach into it are included
            $qb->andWhere('COALESCE(e.dateEnd, e.date) >= :from')->setParameter('from', $from, Types::DATE_IMMUTABLE);
        }
        if (null !== $to) {
            $qb->andWhere('e.date <= :to')->setParameter('to', $to, Types::DATE_IMMUTABLE);
        }
        if ($targetGroupIds) {
            $qb->andWhere('EXISTS (SELECT etg FROM App\Entity\EventTargetGroup etg WHERE etg.event = e AND etg.targetGroup IN (:tgIds))')
               ->setParameter('tgIds', $targetGroupIds);
        }

        return array_map(fn (Event $e) => $this->serializeEvent($e), $qb->getQuery()->getResult());
    }

    public function createEvent(Calendar $calendar, array $data): array
    {
        $event = $this->buildEvent($calendar, $data);
        $this->em->flush();

        return $this->serializeEvent($event);
    }

    public function createSeriesFromTemplate(Calendar $calendar, string $templateId, array $dates, array $overrides): array
    {
        $template = $this->em->getRepository(EventTemplate::class)->find($templateId);
        if (!$template || $template->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Template not found');
        }

        $input = $this->templateInput($template, $overrides);
        $events = [];
        foreach ($dates as $dateStr) {
            $input['date'] = $dateStr;
            $events[] = $this->buildEvent($calendar, $input);
        }
        $this->em->flush();

        return array_map(fn (Event $e) => $this->serializeEvent($e), $events);
    }

    /**
     * Event input from a template plus overrides of the request (`from-template` and series): name, zone,
     * times, all-day, draft and the assignments of the template unless the request brings its own.
     * A template without times creates all-day events unless the request brings its own times
     * (stored as 00:00 – 23:59 like all-day events from the form and the import).
     */
    public function templateInput(EventTemplate $template, array $overrides): array
    {
        $input = [
            'name' => $template->getName(),
            'timezone' => $template->getTimezone(),
            'timeBegin' => $template->getTimeBegin(),
            'timeEnd' => $template->getTimeEnd(),
            'isDraft' => true,
            'locationId' => $template->getLocation()?->getId(),
            'eventTemplateId' => $template->getId(),
            'propertyIds' => array_map(fn ($p) => $p->getProperty()->getId(), $template->getProperties()->getValues()),
            'featureIds' => array_map(fn ($f) => $f->getFeature()->getId(), $template->getFeatures()->getValues()),
            'targetGroupIds' => array_map(fn ($t) => $t->getTargetGroup()->getId(), $template->getTargetGroups()->getValues()),
        ];
        foreach (['name', 'timezone', 'timeBegin', 'timeEnd', 'isAllDay', 'isDraft', 'propertyIds', 'featureIds', 'targetGroupIds'] as $key) {
            if (isset($overrides[$key])) {
                $input[$key] = $overrides[$key];
            }
        }
        if (null === $input['timeBegin'] && null === $input['timeEnd']) {
            $input['isAllDay'] ??= true;
            if ($input['isAllDay']) {
                $input['timeBegin'] = '00:00';
                $input['timeEnd'] = '23:59';
            }
        }
        if (array_key_exists('locationId', $overrides)) {
            $input['locationId'] = $overrides['locationId'];
        }

        return $input;
    }

    public function getEvent(string $id, Calendar $calendar): array
    {
        $event = $this->findEvent($id, $calendar);
        $series = $event->getSeries();

        return $this->serializeEvent($event) + [
            'series' => $series ? $this->serializeSeries($series, $this->countSeriesEvents($series)) : null,
        ];
    }

    /** Scopes of PATCH / DELETE on a series event: only this event (default) or all events of its series. */
    public const SCOPES = ['this', 'all'];

    /** Fields that `scope: "all"` applies only to the edited event (each event keeps its own day). */
    private const OWN_FIELDS = ['date', 'dateEnd', 'eventTemplateId', 'externalUid'];

    /**
     * PATCH. `scope: "all"` applies the sent fields (except the date fields and the template) to every
     * event of the series in one transaction; fields not sent stay as they are, also on events edited on
     * their own before. With `this` (default) or without a series only this event changes; it stays in
     * its series either way.
     */
    public function updateEvent(string $id, Calendar $calendar, array $data): array
    {
        $scope = $this->scope($data['scope'] ?? null);
        unset($data['scope']);
        $event = $this->findEvent($id, $calendar);
        $this->applyInput($event, $calendar, $data, true);

        $series = $event->getSeries();
        $shared = array_diff_key($data, array_flip(self::OWN_FIELDS));
        if ('all' === $scope && null !== $series && [] !== $shared) {
            // Ids as stored (lower case), so the references come from the identity map after the first event
            foreach (['locationId', 'propertyIds', 'featureIds', 'targetGroupIds'] as $key) {
                if (is_string($shared[$key] ?? null)) {
                    $shared[$key] = strtolower($shared[$key]);
                } elseif (is_array($shared[$key] ?? null)) {
                    $shared[$key] = array_map(fn ($v) => is_string($v) ? strtolower($v) : $v, $shared[$key]);
                }
            }
            foreach ($this->seriesEventsWithLinks($series, $event) as $other) {
                $this->applyInput($other, $calendar, $shared, true);
            }
        }
        $this->em->flush();

        return $this->serializeEvent($event);
    }

    /**
     * DELETE. `scope: "all"` deletes every event of the series and the series; `this` (default) only the
     * event, and the series once its last event is gone.
     */
    public function deleteEvent(string $id, Calendar $calendar, mixed $scope = null): void
    {
        $scope = $this->scope($scope);
        $event = $this->findEvent($id, $calendar);
        $series = $event->getSeries();

        $this->em->wrapInTransaction(function () use ($event, $series, $scope, $calendar): void {
            if ('all' === $scope && null !== $series) {
                // Assignments go with the events (ON DELETE CASCADE in the database)
                $this->em->createQuery('DELETE FROM '.Event::class.' e WHERE e.series = :series AND e.calendar = :calendar')
                    ->setParameter('series', $series->getId())
                    ->setParameter('calendar', $calendar->getId())
                    ->execute();
                $this->em->detach($event);
            } else {
                $this->em->remove($event);
                $this->em->flush();
            }
            $this->removeEmptySeries($calendar);
        });
    }

    private function scope(mixed $scope): string
    {
        $scope ??= 'this';
        if (!is_string($scope) || !in_array($scope, self::SCOPES, true)) {
            throw Input::invalid('scope', 'scope must be one of: '.implode(', ', self::SCOPES));
        }

        return $scope;
    }

    /**
     * The other events of the series with their assignments loaded in one query per assignment type
     * (no query per event when the links are synced).
     *
     * @return list<Event>
     */
    private function seriesEventsWithLinks(EventSeries $series, Event $except): array
    {
        $events = [];
        foreach (['properties', 'features', 'targetGroups'] as $link) {
            $events = $this->em->createQueryBuilder()
                ->select('e', 'l')
                ->from(Event::class, 'e')
                ->leftJoin("e.$link", 'l')
                ->where('e.series = :series')
                ->andWhere('e.id <> :id')
                ->setParameter('series', $series->getId())
                ->setParameter('id', $except->getId())
                ->getQuery()
                ->getResult();
        }

        return $events;
    }

    /** Removes the calendar's series that have no events any more (after deleting events). */
    public function removeEmptySeries(Calendar $calendar): void
    {
        $this->em->getConnection()->executeStatement(
            'DELETE FROM event_series WHERE calendar_id = ? AND NOT EXISTS (SELECT 1 FROM event e WHERE e.series_id = event_series.id)',
            [$calendar->getId()],
        );
    }

    public function countSeriesEvents(EventSeries $series): int
    {
        return (int) $this->em->createQueryBuilder()
            ->select('COUNT(e.id)')
            ->from(Event::class, 'e')
            ->where('e.series = :series')
            ->setParameter('series', $series->getId())
            ->getQuery()
            ->getSingleScalarResult();
    }

    public function serializeSeries(EventSeries $series, int $eventCount): array
    {
        return [
            'id' => $series->getId(),
            'calendarId' => $series->getCalendar()->getId(),
            'templateId' => $series->getTemplate()?->getId(),
            'rule' => $series->getRule()->toArray(),
            'eventCount' => $eventCount,
            'createdAt' => $series->getCreatedAt()->format('Y-m-d\\TH:i:s\\Z'),
        ];
    }

    /** Most ids per bulk request (more → 413 `too_many_events`). */
    public const BULK_MAX = 5000;
    public const BULK_ACTIONS = ['publish', 'draft', 'delete'];

    /**
     * Publishes, unpublishes or deletes several events of the calendar in one transaction. All ids must
     * belong to the calendar (unknown and foreign ids alike → 422 `unknown_reference`, nothing happens);
     * duplicate ids count once.
     *
     * @return array{affected: int}
     */
    public function bulk(Calendar $calendar, array $data): array
    {
        $action = $data['action'] ?? null;
        if (!is_string($action) || !in_array($action, self::BULK_ACTIONS, true)) {
            throw Input::invalid('action', 'action must be one of: '.implode(', ', self::BULK_ACTIONS));
        }
        $raw = $data['ids'] ?? null;
        if (!is_array($raw) || [] === $raw || !array_is_list($raw)) {
            throw Input::invalid('ids', 'ids must be a non-empty list of event ids');
        }
        $ids = [];
        foreach ($raw as $id) {
            if (!is_string($id) || '' === $id || strlen($id) > 36) {
                throw Input::invalid('ids', 'ids must be a non-empty list of event ids');
            }
            // The database compares ids case-insensitively; stored ids are lower case.
            $ids[strtolower($id)] = true;
        }
        $ids = array_keys($ids);
        if (count($ids) > self::BULK_MAX) {
            throw new ApiProblemException(413, sprintf('Maximum %d events per bulk action', self::BULK_MAX), EventImportService::TOO_MANY_CODE, 'ids');
        }

        $found = $this->em->createQueryBuilder()
            ->select('e.id')
            ->from(Event::class, 'e')
            ->where('e.calendar = :calendar')
            ->andWhere('e.id IN (:ids)')
            ->setParameter('calendar', $calendar)
            ->setParameter('ids', $ids)
            ->getQuery()
            ->getSingleColumnResult();
        $missing = array_values(array_diff($ids, array_map(fn ($id) => strtolower((string) $id), $found)));
        if ([] !== $missing) {
            throw CalendarReferences::unknown('ids', $missing[0]);
        }

        $qb = $this->em->createQueryBuilder();
        if ('delete' === $action) {
            // Assignments go with the event (ON DELETE CASCADE in the database)
            $qb->delete(Event::class, 'e');
        } else {
            $qb->update(Event::class, 'e')->set('e.isDraft', ':draft')->setParameter('draft', 'draft' === $action);
        }
        $qb->where('e.calendar = :calendar')
            ->andWhere('e.id IN (:ids)')
            ->setParameter('calendar', $calendar)
            ->setParameter('ids', $ids);

        $this->em->wrapInTransaction(function () use ($qb, $action, $calendar): void {
            $qb->getQuery()->execute();
            if ('delete' === $action) {
                // A series whose last events were deleted goes too
                $this->removeEmptySeries($calendar);
            }
        });

        // `affected` = events of the request (an update to the same value reports no changed row in MySQL)
        return ['affected' => count($ids)];
    }

    private function findEvent(string $id, Calendar $calendar): Event
    {
        $event = $this->em->getRepository(Event::class)->find($id);
        if (!$event || $event->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event not found');
        }

        return $event;
    }

    /**
     * New, persisted (not flushed) event from request data.
     *
     * @param bool $dryRun validate only: the event is neither persisted nor linked (import preview)
     */
    public function buildEvent(Calendar $calendar, array $data, bool $dryRun = false): Event
    {
        $event = new Event();
        $event->setCalendar($calendar);
        $this->applyInput($event, $calendar, $data, false, $dryRun);
        if (!$dryRun) {
            $this->em->persist($event);
        }

        return $event;
    }

    /**
     * Validates and applies request data. All referenced records must belong to the same calendar;
     * unknown ids and ids of other calendars are rejected alike (422), so nothing about other calendars leaks.
     *
     * @param bool $partial PATCH: only the given keys are applied, nothing is required
     * @param bool $dryRun  validate the assignments without linking them (nothing is persisted)
     */
    private function applyInput(Event $event, Calendar $calendar, array $data, bool $partial, bool $dryRun = false): void
    {
        $has = fn (string $key) => !$partial || array_key_exists($key, $data);
        // PATCH: a missing or null id list leaves the assignments unchanged
        $hasList = fn (string $key) => !$partial || null !== ($data[$key] ?? null);

        if ($has('name')) {
            $event->setName(Input::string($data, 'name'));
        }
        if ($has('timezone')) {
            $event->setTimezone(Input::timezone($data, 'timezone'));
        }
        if ($has('date')) {
            $event->setDate(Input::date($data, 'date'));
        }
        if ($has('dateEnd')) {
            $dateEnd = $data['dateEnd'] ?? null;
            $event->setDateEnd(null === $dateEnd || '' === $dateEnd ? null : Input::parseDate($dateEnd, 'dateEnd'));
        }
        if ($has('timeBegin')) {
            $event->setTimeBegin(Input::time($data, 'timeBegin'));
        }
        if ($has('timeEnd')) {
            $event->setTimeEnd(Input::time($data, 'timeEnd'));
        }
        foreach (['isAllDay' => $event->setIsAllDay(...), 'isDraft' => $event->setIsDraft(...)] as $key => $set) {
            if (array_key_exists($key, $data) && null !== $data[$key]) {
                $set(Input::bool($data, $key));
            }
        }
        if (null !== $event->getDateEnd() && $event->getDateEnd() < $event->getDate()) {
            throw Input::invalid('dateEnd', 'dateEnd must not be before date');
        }

        if ($has('locationId')) {
            $event->setLocation($this->references->find(Location::class, $calendar, $data['locationId'] ?? null, 'locationId'));
        }
        if ($has('eventTemplateId')) {
            $event->setTemplate($this->references->find(EventTemplate::class, $calendar, $data['eventTemplateId'] ?? null, 'eventTemplateId'));
        }

        if ($hasList('propertyIds')) {
            $properties = $this->references->findAll(Property::class, $calendar, Input::idList($data, 'propertyIds'), 'propertyIds');
            if (!$dryRun) {
                LinkCollectionSync::sync(
                    $this->em,
                    $event->getProperties(),
                    array_keys($properties),
                    fn (EventProperty $ep) => $ep->getProperty()->getId(),
                    fn (string $id) => (new EventProperty())->setEvent($event)->setProperty($properties[$id]),
                );
            }
        }
        if ($hasList('featureIds')) {
            $features = $this->references->findAll(Feature::class, $calendar, Input::idList($data, 'featureIds'), 'featureIds');
            if (!$dryRun) {
                LinkCollectionSync::sync(
                    $this->em,
                    $event->getFeatures(),
                    array_keys($features),
                    fn (EventFeature $ef) => $ef->getFeature()->getId(),
                    fn (string $id) => (new EventFeature())->setEvent($event)->setFeature($features[$id]),
                );
            }
        }
        if ($hasList('targetGroupIds')) {
            $groups = $this->references->findAll(TargetGroup::class, $calendar, Input::idList($data, 'targetGroupIds'), 'targetGroupIds');
            if (!$dryRun) {
                LinkCollectionSync::sync(
                    $this->em,
                    $event->getTargetGroups(),
                    array_keys($groups),
                    fn (EventTargetGroup $etg) => $etg->getTargetGroup()->getId(),
                    fn (string $id) => (new EventTargetGroup())->setEvent($event)->setTargetGroup($groups[$id]),
                );
            }
        }
    }

    public function serializeEvent(Event $event): array
    {
        return [
            'id' => $event->getId(),
            'calendarId' => $event->getCalendar()->getId(),
            'eventTemplateId' => $event->getTemplate()?->getId(),
            'seriesId' => $event->getSeries()?->getId(),
            'locationId' => $event->getLocation()?->getId(),
            'name' => $event->getName(),
            'timezone' => $event->getTimezone(),
            'date' => $event->getDate()->format('Y-m-d'),
            'dateEnd' => $event->getDateEnd()?->format('Y-m-d'),
            'timeBegin' => $event->getTimeBegin(),
            'timeEnd' => $event->getTimeEnd(),
            'isAllDay' => $event->isAllDay(),
            'isDraft' => $event->isDraft(),
            'externalUid' => $event->getExternalUid(),
            'location' => $event->getLocation() ? [
                'id' => $event->getLocation()->getId(),
                'name' => $event->getLocation()->getName(),
                'street' => $event->getLocation()->getStreet(),
                'zip' => $event->getLocation()->getZip(),
                'city' => $event->getLocation()->getCity(),
                'country' => $event->getLocation()->getCountry(),
                'latitude' => $event->getLocation()->getLatitude(),
                'longitude' => $event->getLocation()->getLongitude(),
            ] : null,
            'template' => $event->getTemplate() ? [
                'id' => $event->getTemplate()->getId(),
                'name' => $event->getTemplate()->getName(),
            ] : null,
            'properties' => $event->getProperties()->map(fn ($ep) => [
                'propertyId' => $ep->getProperty()->getId(),
                'property' => [
                    'id' => $ep->getProperty()->getId(),
                    'name' => $ep->getProperty()->getName(),
                    'icon' => $ep->getProperty()->getIcon(),
                ],
            ])->getValues(),
            'features' => $event->getFeatures()->map(fn ($ef) => [
                'featureId' => $ef->getFeature()->getId(),
                'feature' => [
                    'id' => $ef->getFeature()->getId(),
                    'name' => $ef->getFeature()->getName(),
                ],
            ])->getValues(),
            'targetGroups' => $event->getTargetGroups()->map(fn ($etg) => [
                'targetGroupId' => $etg->getTargetGroup()->getId(),
                'targetGroup' => [
                    'id' => $etg->getTargetGroup()->getId(),
                    'name' => $etg->getTargetGroup()->getName(),
                ],
            ])->getValues(),
        ];
    }
}
