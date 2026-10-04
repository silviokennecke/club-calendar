<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class EventService
{
    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
    ) {
    }

    public function listEvents(Calendar $calendar, ?string $from, ?string $to, ?array $targetGroupIds): array
    {
        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->where('e.calendar = :calendar')
            ->setParameter('calendar', $calendar)
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC');

        if ($from) {
            if (false === strtotime($from)) {
                throw new BadRequestHttpException('Invalid from date');
            }
            try {
                // Overlap: multi-day events that started before the range but reach into it are included
                $qb->andWhere('COALESCE(e.dateEnd, e.date) >= :from')->setParameter('from', new \DateTimeImmutable($from));
            } catch (\DateMalformedStringException) {
                throw new BadRequestHttpException('Invalid from date');
            }
        }
        if ($to) {
            if (false === strtotime($to)) {
                throw new BadRequestHttpException('Invalid to date');
            }
            try {
                $qb->andWhere('e.date <= :to')->setParameter('to', new \DateTimeImmutable($to));
            } catch (\DateMalformedStringException) {
                throw new BadRequestHttpException('Invalid to date');
            }
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

        $input = [
            'name' => $template->getName(),
            'timezone' => $template->getTimezone(),
            'timeBegin' => $template->getTimeBegin(),
            'timeEnd' => $template->getTimeEnd(),
            'isDraft' => true,
            'locationId' => $template->getLocation()?->getId(),
            'eventTemplateId' => $template->getId(),
            'propertyIds' => array_map(fn ($p) => $p->getProperty()->getId(), $template->getProperties()->toArray()),
            'featureIds' => array_map(fn ($f) => $f->getFeature()->getId(), $template->getFeatures()->toArray()),
            'targetGroupIds' => array_map(fn ($t) => $t->getTargetGroup()->getId(), $template->getTargetGroups()->toArray()),
        ];
        foreach (['name', 'timezone', 'timeBegin', 'timeEnd', 'isAllDay', 'isDraft', 'propertyIds', 'featureIds', 'targetGroupIds'] as $key) {
            if (isset($overrides[$key])) {
                $input[$key] = $overrides[$key];
            }
        }
        if (array_key_exists('locationId', $overrides)) {
            $input['locationId'] = $overrides['locationId'];
        }

        $events = [];
        foreach ($dates as $dateStr) {
            $input['date'] = $dateStr;
            $events[] = $this->buildEvent($calendar, $input);
        }
        $this->em->flush();

        return array_map(fn (Event $e) => $this->serializeEvent($e), $events);
    }

    public function importEvents(Calendar $calendar, array $eventsData): int
    {
        foreach (array_values($eventsData) as $i => $data) {
            try {
                if (!is_array($data)) {
                    throw new BadRequestHttpException('event must be an object');
                }
                $this->buildEvent($calendar, $data);
            } catch (HttpException $e) {
                // Name the failing entry; nothing is stored (no flush)
                throw new HttpException($e->getStatusCode(), sprintf('events[%d]: %s', $i, $e->getMessage()), $e);
            }
        }
        $this->em->flush();

        return count($eventsData);
    }

    public function getEvent(string $id, Calendar $calendar): array
    {
        return $this->serializeEvent($this->findEvent($id, $calendar));
    }

    public function updateEvent(string $id, Calendar $calendar, array $data): array
    {
        $event = $this->findEvent($id, $calendar);
        $this->applyInput($event, $calendar, $data, true);
        $this->em->flush();

        return $this->serializeEvent($event);
    }

    public function deleteEvent(string $id, Calendar $calendar): void
    {
        $event = $this->findEvent($id, $calendar);
        $this->em->remove($event);
        $this->em->flush();
    }

    private function findEvent(string $id, Calendar $calendar): Event
    {
        $event = $this->em->getRepository(Event::class)->find($id);
        if (!$event || $event->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event not found');
        }

        return $event;
    }

    /** New, persisted (not flushed) event from request data. */
    private function buildEvent(Calendar $calendar, array $data): Event
    {
        $event = new Event();
        $event->setCalendar($calendar);
        $this->applyInput($event, $calendar, $data, false);
        $this->em->persist($event);

        return $event;
    }

    /**
     * Validates and applies request data. All referenced records must belong to the same calendar;
     * unknown ids and ids of other calendars are rejected alike (422), so nothing about other calendars leaks.
     *
     * @param bool $partial PATCH: only the given keys are applied, nothing is required
     */
    private function applyInput(Event $event, Calendar $calendar, array $data, bool $partial): void
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
            throw new BadRequestHttpException('dateEnd must not be before date');
        }

        if ($has('locationId')) {
            $event->setLocation($this->references->find(Location::class, $calendar, $data['locationId'] ?? null, 'locationId'));
        }
        if ($has('eventTemplateId')) {
            $event->setTemplate($this->references->find(EventTemplate::class, $calendar, $data['eventTemplateId'] ?? null, 'eventTemplateId'));
        }

        if ($hasList('propertyIds')) {
            $properties = $this->references->findAll(Property::class, $calendar, Input::idList($data, 'propertyIds'), 'propertyIds');
            LinkCollectionSync::sync(
                $this->em,
                $event->getProperties(),
                array_keys($properties),
                fn (EventProperty $ep) => $ep->getProperty()->getId(),
                fn (string $id) => (new EventProperty())->setEvent($event)->setProperty($properties[$id]),
            );
        }
        if ($hasList('featureIds')) {
            $features = $this->references->findAll(Feature::class, $calendar, Input::idList($data, 'featureIds'), 'featureIds');
            LinkCollectionSync::sync(
                $this->em,
                $event->getFeatures(),
                array_keys($features),
                fn (EventFeature $ef) => $ef->getFeature()->getId(),
                fn (string $id) => (new EventFeature())->setEvent($event)->setFeature($features[$id]),
            );
        }
        if ($hasList('targetGroupIds')) {
            $groups = $this->references->findAll(TargetGroup::class, $calendar, Input::idList($data, 'targetGroupIds'), 'targetGroupIds');
            LinkCollectionSync::sync(
                $this->em,
                $event->getTargetGroups(),
                array_keys($groups),
                fn (EventTargetGroup $etg) => $etg->getTargetGroup()->getId(),
                fn (string $id) => (new EventTargetGroup())->setEvent($event)->setTargetGroup($groups[$id]),
            );
        }
    }

    public function serializeEvent(Event $event): array
    {
        return [
            'id' => $event->getId(),
            'calendarId' => $event->getCalendar()->getId(),
            'eventTemplateId' => $event->getTemplate()?->getId(),
            'locationId' => $event->getLocation()?->getId(),
            'name' => $event->getName(),
            'timezone' => $event->getTimezone(),
            'date' => $event->getDate()->format('Y-m-d'),
            'dateEnd' => $event->getDateEnd()?->format('Y-m-d'),
            'timeBegin' => $event->getTimeBegin(),
            'timeEnd' => $event->getTimeEnd(),
            'isAllDay' => $event->isAllDay(),
            'isDraft' => $event->isDraft(),
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
