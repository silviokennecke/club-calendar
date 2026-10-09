<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Entity\HolidayEvent;
use App\Enum\FeedVisibility;
use App\Repository\HolidayEventRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Mapping\ClassMetadata;
use Doctrine\ORM\QueryBuilder;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class PublicFeedService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly IcsService $icsService,
        private readonly HolidayEventRepository $holidays,
    ) {
    }

    /**
     * Published events of the feed, optionally limited to the days from/to (YYYY-MM-DD, overlap: a
     * multi-day event reaching into the range is included), plus the holidays of the calendar in the
     * same range. Access is checked before the range is looked at.
     */
    public function getFeedEvents(string $feedId, ?string $secret, ?array $targetGroupIds, ?string $from = null, ?string $to = null): array
    {
        $feed = $this->loadFeed($feedId, $secret);
        $fromDate = null === $from || '' === $from ? null : Input::parseDate($from, 'from');
        $toDate = null === $to || '' === $to ? null : Input::parseDate($to, 'to');
        if (null !== $fromDate && null !== $toDate && $toDate < $fromDate) {
            throw new BadRequestHttpException('to must not be before from');
        }

        $events = $this->fetchEvents($this->eventQuery($feed, $targetGroupIds, $fromDate, $toDate));
        $holidays = $this->holidays->findByCalendar($feed->getCalendar()->getId(), $fromDate, $toDate);

        return [
            'feed' => $this->serializeFeed($feed),
            'events' => array_map(fn (Event $e) => $this->serializeEvent($e), $events),
            'holidays' => array_map(fn (HolidayEvent $h) => [
                'id' => $h->getId(),
                'holidayCalendarId' => $h->getHolidayCalendar()->getId(),
                'name' => $h->getName(),
                'date' => $h->getDate()->format('Y-m-d'),
                'dateEnd' => $h->getDateEnd()?->format('Y-m-d'),
            ], $holidays),
        ];
    }

    /**
     * One published event of the feed (same rules as the list: secret first, archived calendar 404,
     * the feed's target groups). Drafts, events of other calendars or outside the feed's audiences
     * and unknown ids are all 404.
     */
    public function getFeedEvent(string $feedId, string $eventId, ?string $secret): array
    {
        $feed = $this->loadFeed($feedId, $secret);
        $event = $this->eventQuery($feed, null, null, null)
            ->andWhere('e.id = :eventId')
            ->setParameter('eventId', $eventId)
            ->getQuery()
            ->getOneOrNullResult();
        if (!$event instanceof Event) {
            throw new NotFoundHttpException('Event not found');
        }

        return ['feed' => $this->serializeFeed($feed), 'event' => $this->serializeEvent($event)];
    }

    /**
     * Header of the public page: club and calendar name, the effective time zone of the calendar
     * (calendar, else club), the visibility (same values as the feed API), the number of published
     * events and the audiences used by them.
     */
    private function serializeFeed(CalendarFeed $feed): array
    {
        $calendar = $feed->getCalendar();

        // Counted over all published events of the feed (not only a from/to range), so the page keeps
        // its audience filter and knows whether the feed is empty; nothing beyond what the feed shows.
        $count = $this->em->createQueryBuilder()->select('COUNT(e.id)')->from(Event::class, 'e');
        $this->restrictToFeed($count, $feed, null);
        $audiences = $this->em->createQueryBuilder()
            ->select('DISTINCT tg.id AS id', 'tg.name AS name')
            ->from(EventTargetGroup::class, 'etg')
            ->join('etg.event', 'e')
            ->join('etg.targetGroup', 'tg')
            ->orderBy('tg.name', 'ASC');
        $this->restrictToFeed($audiences, $feed, null);

        return [
            'id' => $feed->getId(),
            'name' => $feed->getName(),
            'clubName' => $calendar->getClub()->getName(),
            'calendarName' => $calendar->getName(),
            'timezone' => $this->calendarTimezone($calendar),
            'visibility' => $feed->getVisibility()->value,
            'eventCount' => (int) $count->getQuery()->getSingleScalarResult(),
            'audiences' => array_map(
                fn (array $row) => ['id' => (string) $row['id'], 'name' => (string) $row['name']],
                $audiences->getQuery()->getArrayResult(),
            ),
        ];
    }

    private function calendarTimezone(Calendar $calendar): string
    {
        return Input::canonicalTimezone($calendar->getTimezone())
            ?? Input::canonicalTimezone($calendar->getClub()->getTimezone())
            ?? 'UTC';
    }

    public function getFeedIcs(string $feedId, ?string $secret, ?array $targetGroupIds): string
    {
        $feed = $this->loadFeed($feedId, $secret);
        $events = $this->fetchEvents($this->eventQuery($feed, $targetGroupIds, null, null));
        $club = $feed->getCalendar()->getClub();

        return $this->icsService->buildIcs($feed, $club, $events);
    }

    private function loadFeed(string $feedId, ?string $secret): CalendarFeed
    {
        $feed = $this->em->getRepository(CalendarFeed::class)->find($feedId);
        if (!$feed) {
            throw new NotFoundHttpException('Feed not found');
        }

        // Private feed: check the secret first, so that nothing about the feed (e.g. that its calendar
        // is archived) is revealed without access.
        if (FeedVisibility::PRIVATE === $feed->getVisibility()) {
            if (!$secret || !hash_equals($feed->getSharedSecret(), $secret)) {
                throw new AccessDeniedHttpException('Invalid or missing secret');
            }
        }

        // Archived calendar → 404
        if (null !== $feed->getCalendar()->getArchivedAt()) {
            throw new NotFoundHttpException('Feed not found');
        }

        return $feed;
    }

    private function eventQuery(CalendarFeed $feed, ?array $targetGroupIds, ?\DateTimeImmutable $from, ?\DateTimeImmutable $to): QueryBuilder
    {
        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC');
        $this->restrictToFeed($qb, $feed, $targetGroupIds);
        if (null !== $from) {
            $qb->andWhere('COALESCE(e.dateEnd, e.date) >= :from')->setParameter('from', $from, Types::DATE_IMMUTABLE);
        }
        if (null !== $to) {
            $qb->andWhere('e.date <= :to')->setParameter('to', $to, Types::DATE_IMMUTABLE);
        }

        return $qb;
    }

    /**
     * Runs an event query and loads the location and the assignments of all events in batches
     * (one query per association instead of one per event).
     *
     * @return Event[]
     */
    private function fetchEvents(QueryBuilder $qb): array
    {
        $query = $qb->getQuery();
        foreach (['location', 'properties', 'features', 'targetGroups'] as $association) {
            $query->setFetchMode(Event::class, $association, ClassMetadata::FETCH_EAGER);
        }

        return $query->getResult();
    }

    /**
     * Limits the events `e` of a query to what the feed shows: its calendar, published only, and its
     * target groups. The query parameter narrows the selection, but never beyond the feed's own target
     * groups (a feed limited to "Jugend" must not deliver other audiences on request).
     */
    private function restrictToFeed(QueryBuilder $qb, CalendarFeed $feed, ?array $targetGroupIds): void
    {
        $feedTargetGroupIds = $feed->getTargetGroups()
            ->map(fn ($ftg) => $ftg->getTargetGroup()->getId())
            ->toArray();

        $qb->andWhere('e.calendar = :calendar')
            ->andWhere('e.isDraft = false')
            ->setParameter('calendar', $feed->getCalendar());

        $effectiveTgIds = $targetGroupIds;
        if (count($feedTargetGroupIds) > 0) {
            $effectiveTgIds = null === $targetGroupIds
                ? $feedTargetGroupIds
                : array_values(array_intersect($targetGroupIds, $feedTargetGroupIds));
            if ([] === $effectiveTgIds) {
                // Nothing the feed may show was requested
                $qb->andWhere('1 = 0');
            }
        }
        if ($effectiveTgIds) {
            $qb->andWhere('EXISTS (SELECT vetg FROM App\Entity\EventTargetGroup vetg WHERE vetg.event = e AND vetg.targetGroup IN (:tgIds))')
               ->setParameter('tgIds', $effectiveTgIds);
        }
    }

    private function serializeEvent(Event $e): array
    {
        return [
            'id' => $e->getId(),
            'calendarId' => $e->getCalendar()->getId(),
            'name' => $e->getName(),
            'date' => $e->getDate()->format('Y-m-d'),
            'dateEnd' => $e->getDateEnd()?->format('Y-m-d'),
            'timeBegin' => $e->getTimeBegin(),
            'timeEnd' => $e->getTimeEnd(),
            'isAllDay' => $e->isAllDay(),
            // effective zone: event, else calendar, else club (as in the ICS feed)
            'timezone' => Input::canonicalTimezone($e->getTimezone()) ?? $this->calendarTimezone($e->getCalendar()),
            'location' => $e->getLocation() ? [
                'id' => $e->getLocation()->getId(),
                'name' => $e->getLocation()->getName(),
                'street' => $e->getLocation()->getStreet(),
                'zip' => $e->getLocation()->getZip(),
                'city' => $e->getLocation()->getCity(),
                'country' => $e->getLocation()->getCountry(),
                'latitude' => $e->getLocation()->getLatitude(),
                'longitude' => $e->getLocation()->getLongitude(),
                'updatedAt' => $e->getLocation()->getUpdatedAt()->getTimestamp(),
            ] : null,
            'properties' => $e->getProperties()->map(fn ($ep) => [
                'propertyId' => $ep->getProperty()->getId(),
                'property' => [
                    'id' => $ep->getProperty()->getId(),
                    'name' => $ep->getProperty()->getName(),
                    'icon' => $ep->getProperty()->getIcon(),
                ],
            ])->toArray(),
            'features' => $e->getFeatures()->map(fn ($ef) => [
                'featureId' => $ef->getFeature()->getId(),
                'feature' => [
                    'id' => $ef->getFeature()->getId(),
                    'name' => $ef->getFeature()->getName(),
                ],
            ])->toArray(),
            'targetGroups' => $e->getTargetGroups()->map(fn ($etg) => [
                'targetGroupId' => $etg->getTargetGroup()->getId(),
                'targetGroup' => [
                    'id' => $etg->getTargetGroup()->getId(),
                    'name' => $etg->getTargetGroup()->getName(),
                ],
            ])->toArray(),
        ];
    }
}
