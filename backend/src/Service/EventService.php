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
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class EventService
{
    public function __construct(private EntityManagerInterface $em)
    {
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
                $qb->andWhere('e.date >= :from')->setParameter('from', new \DateTimeImmutable($from));
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
        $this->em->persist($event);
        $this->syncRelations($event, $data);
        $this->em->flush();

        return $this->serializeEvent($event);
    }

    public function createSeriesFromTemplate(Calendar $calendar, string $templateId, array $dates, array $overrides): array
    {
        $template = $this->em->getRepository(EventTemplate::class)->find($templateId);
        if (!$template || $template->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Template not found');
        }

        $propertyIds = $overrides['propertyIds'] ?? array_map(
            fn ($p) => $p->getProperty()->getId(),
            $template->getProperties()->toArray(),
        );
        $featureIds = $overrides['featureIds'] ?? array_map(
            fn ($f) => $f->getFeature()->getId(),
            $template->getFeatures()->toArray(),
        );
        $targetGroupIds = $overrides['targetGroupIds'] ?? array_map(
            fn ($t) => $t->getTargetGroup()->getId(),
            $template->getTargetGroups()->toArray(),
        );
        $locationId = array_key_exists('locationId', $overrides)
            ? $overrides['locationId']
            : $template->getLocation()?->getId();
        $isDraft = $overrides['isDraft'] ?? true;

        $events = [];
        foreach ($dates as $dateStr) {
            $event = new Event();
            $event->setCalendar($calendar);
            $event->setTemplate($template);
            $event->setName($overrides['name'] ?? $template->getName());
            $event->setTimezone($overrides['timezone'] ?? $template->getTimezone());
            try {
                $event->setDate(new \DateTimeImmutable($dateStr));
            } catch (\DateMalformedStringException) {
                throw new BadRequestHttpException(sprintf('Invalid date: %s', $dateStr));
            }
            $event->setTimeBegin($overrides['timeBegin'] ?? $template->getTimeBegin());
            $event->setTimeEnd($overrides['timeEnd'] ?? $template->getTimeEnd());
            $event->setIsDraft($isDraft);

            if (isset($overrides['isAllDay'])) {
                $event->setIsAllDay($overrides['isAllDay']);
            }

            if ($locationId) {
                $loc = $this->em->getRepository(Location::class)->find($locationId);
                if ($loc) {
                    $event->setLocation($loc);
                }
            }

            $this->em->persist($event);
            $this->syncManyToMany($event, $propertyIds, $featureIds, $targetGroupIds);
            $events[] = $event;
        }
        $this->em->flush();

        return array_map(fn (Event $e) => $this->serializeEvent($e), $events);
    }

    public function importEvents(Calendar $calendar, array $eventsData): int
    {
        foreach ($eventsData as $data) {
            $event = $this->buildEvent($calendar, $data);
            $this->em->persist($event);
            $this->syncRelations($event, $data);
        }
        $this->em->flush();

        return count($eventsData);
    }

    public function getEvent(string $id, Calendar $calendar): array
    {
        $event = $this->em->getRepository(Event::class)->find($id);
        if (!$event || $event->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event not found');
        }

        return $this->serializeEvent($event);
    }

    public function updateEvent(string $id, Calendar $calendar, array $data): array
    {
        $event = $this->em->getRepository(Event::class)->find($id);
        if (!$event || $event->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event not found');
        }

        if (array_key_exists('name', $data)) {
            $event->setName($data['name']);
        }
        if (array_key_exists('timezone', $data)) {
            $event->setTimezone($data['timezone']);
        }
        if (array_key_exists('date', $data)) {
            try {
                $event->setDate(new \DateTimeImmutable($data['date']));
            } catch (\DateMalformedStringException) {
                throw new BadRequestHttpException('Invalid date');
            }
        }
        if (array_key_exists('dateEnd', $data)) {
            try {
                $event->setDateEnd($data['dateEnd'] ? new \DateTimeImmutable($data['dateEnd']) : null);
            } catch (\DateMalformedStringException) {
                throw new BadRequestHttpException('Invalid dateEnd');
            }
        }
        if (array_key_exists('timeBegin', $data)) {
            $event->setTimeBegin($data['timeBegin']);
        }
        if (array_key_exists('timeEnd', $data)) {
            $event->setTimeEnd($data['timeEnd']);
        }
        if (array_key_exists('isAllDay', $data)) {
            $event->setIsAllDay($data['isAllDay']);
        }
        if (array_key_exists('isDraft', $data)) {
            $event->setIsDraft($data['isDraft']);
        }

        if (array_key_exists('locationId', $data)) {
            $loc = $data['locationId']
                ? $this->em->getRepository(Location::class)->find($data['locationId'])
                : null;
            $event->setLocation($loc);
        }
        if (array_key_exists('eventTemplateId', $data)) {
            $tmpl = $data['eventTemplateId']
                ? $this->em->getRepository(EventTemplate::class)->find($data['eventTemplateId'])
                : null;
            $event->setTemplate($tmpl);
        }

        $propertyIds = $data['propertyIds'] ?? null;
        $featureIds = $data['featureIds'] ?? null;
        $targetGroupIds = $data['targetGroupIds'] ?? null;

        if (null !== $propertyIds) {
            LinkCollectionSync::sync(
                $this->em,
                $event->getProperties(),
                $propertyIds,
                fn (EventProperty $ep) => $ep->getProperty()->getId(),
                function (string $id) use ($event): ?EventProperty {
                    $prop = $this->em->getRepository(Property::class)->find($id);

                    return $prop ? (new EventProperty())->setEvent($event)->setProperty($prop) : null;
                },
            );
        }
        if (null !== $featureIds) {
            LinkCollectionSync::sync(
                $this->em,
                $event->getFeatures(),
                $featureIds,
                fn (EventFeature $ef) => $ef->getFeature()->getId(),
                function (string $id) use ($event): ?EventFeature {
                    $feat = $this->em->getRepository(Feature::class)->find($id);

                    return $feat ? (new EventFeature())->setEvent($event)->setFeature($feat) : null;
                },
            );
        }
        if (null !== $targetGroupIds) {
            LinkCollectionSync::sync(
                $this->em,
                $event->getTargetGroups(),
                $targetGroupIds,
                fn (EventTargetGroup $etg) => $etg->getTargetGroup()->getId(),
                function (string $id) use ($event): ?EventTargetGroup {
                    $tg = $this->em->getRepository(TargetGroup::class)->find($id);

                    return $tg ? (new EventTargetGroup())->setEvent($event)->setTargetGroup($tg) : null;
                },
            );
        }

        $this->em->flush();

        return $this->serializeEvent($event);
    }

    public function deleteEvent(string $id, Calendar $calendar): void
    {
        $event = $this->em->getRepository(Event::class)->find($id);
        if (!$event || $event->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Event not found');
        }
        $this->em->remove($event);
        $this->em->flush();
    }

    private function buildEvent(Calendar $calendar, array $data): Event
    {
        $event = new Event();
        $event->setCalendar($calendar);
        $event->setName($data['name']);
        try {
            $event->setDate(new \DateTimeImmutable($data['date']));
        } catch (\DateMalformedStringException) {
            throw new BadRequestHttpException('Invalid date');
        }
        $event->setTimeBegin($data['timeBegin']);
        $event->setTimeEnd($data['timeEnd']);

        if (isset($data['timezone'])) {
            $event->setTimezone($data['timezone']);
        }
        if (!empty($data['dateEnd'])) {
            try {
                $event->setDateEnd(new \DateTimeImmutable($data['dateEnd']));
            } catch (\DateMalformedStringException) {
                throw new BadRequestHttpException('Invalid dateEnd');
            }
        }
        if (isset($data['isAllDay'])) {
            $event->setIsAllDay($data['isAllDay']);
        }
        if (isset($data['isDraft'])) {
            $event->setIsDraft($data['isDraft']);
        }
        if (!empty($data['locationId'])) {
            $loc = $this->em->getRepository(Location::class)->find($data['locationId']);
            if ($loc) {
                $event->setLocation($loc);
            }
        }
        if (!empty($data['eventTemplateId'])) {
            $tmpl = $this->em->getRepository(EventTemplate::class)->find($data['eventTemplateId']);
            if ($tmpl) {
                $event->setTemplate($tmpl);
            }
        }

        return $event;
    }

    private function syncRelations(Event $event, array $data): void
    {
        $this->syncManyToMany(
            $event,
            $data['propertyIds'] ?? [],
            $data['featureIds'] ?? [],
            $data['targetGroupIds'] ?? [],
        );
    }

    private function syncManyToMany(Event $event, array $propertyIds, array $featureIds, array $targetGroupIds): void
    {
        foreach ($propertyIds as $pid) {
            $prop = $this->em->getRepository(Property::class)->find($pid);
            if ($prop) {
                $ep = new EventProperty();
                $ep->setEvent($event);
                $ep->setProperty($prop);
                $this->em->persist($ep);
            }
        }
        foreach ($featureIds as $fid) {
            $feat = $this->em->getRepository(Feature::class)->find($fid);
            if ($feat) {
                $ef = new EventFeature();
                $ef->setEvent($event);
                $ef->setFeature($feat);
                $this->em->persist($ef);
            }
        }
        foreach ($targetGroupIds as $tgid) {
            $tg = $this->em->getRepository(TargetGroup::class)->find($tgid);
            if ($tg) {
                $etg = new EventTargetGroup();
                $etg->setEvent($event);
                $etg->setTargetGroup($tg);
                $this->em->persist($etg);
            }
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
