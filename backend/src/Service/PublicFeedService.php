<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Entity\HolidayEvent;
use App\EventListener\FeedResponseHeadersListener;
use App\Ics\IcsEventReader;
use App\Repository\HolidayEventRepository;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Mapping\ClassMetadata;
use Doctrine\ORM\QueryBuilder;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class PublicFeedService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly IcsService $icsService,
        private readonly IcsEventReader $icsReader,
        private readonly HolidayEventRepository $holidays,
        private readonly RequestStack $requestStack,
        #[Autowire(env: 'bool:FEED_ICS_WINDOW_ENABLED')]
        private readonly bool $icsWindowEnabled = true,
        #[Autowire(env: 'int:FEED_ICS_PAST_DAYS')]
        private readonly int $icsPastDays = 180,
        #[Autowire(env: 'int:FEED_ICS_FUTURE_MONTHS')]
        private readonly int $icsFutureMonths = 24,
        #[Autowire(env: 'int:FEED_ICS_MAX_EVENTS')]
        private readonly int $icsMaxEvents = 0,
    ) {
        foreach (['FEED_ICS_PAST_DAYS' => $icsPastDays, 'FEED_ICS_FUTURE_MONTHS' => $icsFutureMonths, 'FEED_ICS_MAX_EVENTS' => $icsMaxEvents] as $name => $value) {
            if ($value < 0) {
                throw new \InvalidArgumentException(sprintf('%s must be an integer >= 0, got %d', $name, $value));
            }
        }
    }

    /**
     * Published events of the feed, optionally limited to the days from/to (YYYY-MM-DD, overlap: a
     * multi-day event reaching into the range is included), plus the holidays of the selected calendars (de-duplicated by uid) in the
     * same range. Access is checked before the range is looked at.
     */
    public function getFeedEvents(string $feedId, ?string $secret, ?array $targetGroupIds, mixed $from = null, mixed $to = null): array
    {
        $feed = $this->loadFeed($feedId, $secret);
        $fromDate = Input::optionalDate($from, 'from');
        $toDate = Input::optionalDate($to, 'to');
        Input::assertDateRange($fromDate, $toDate);

        $events = $this->fetchEvents($this->eventQuery($feed, $targetGroupIds, $fromDate, $toDate));
        $holidays = $this->dedupeHolidays($this->holidays->findByCalendars($this->activeCalendarIds($feed), $fromDate, $toDate));

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
     * The same holiday (same non-empty uid) of several calendars is shown once; the first in
     * date-then-id order wins. Holidays without uid are never collapsed.
     *
     * @param HolidayEvent[] $holidays
     *
     * @return HolidayEvent[]
     */
    private function dedupeHolidays(array $holidays): array
    {
        usort($holidays, fn (HolidayEvent $a, HolidayEvent $b) => [$a->getDate(), $a->getId()] <=> [$b->getDate(), $b->getId()]);
        $seen = [];
        $result = [];
        foreach ($holidays as $h) {
            if ('' !== $h->getUid()) {
                if (isset($seen[$h->getUid()])) {
                    continue;
                }
                $seen[$h->getUid()] = true;
            }
            $result[] = $h;
        }

        return $result;
    }

    /**
     * Selected calendars of the feed that are not archived.
     *
     * @return Calendar[]
     */
    private function activeCalendars(CalendarFeed $feed): array
    {
        $calendars = [];
        foreach ($feed->getCalendars() as $link) {
            $calendar = $link->getCalendar();
            if (null === $calendar->getArchivedAt()) {
                $calendars[] = $calendar;
            }
        }

        return $calendars;
    }

    /** @return string[] */
    private function activeCalendarIds(CalendarFeed $feed): array
    {
        return array_map(fn (Calendar $c) => $c->getId(), $this->activeCalendars($feed));
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
     * Header of the public page: feed name, club name, the time zone of the club, the visibility (same values as the feed API: PUBLIC, CLUB, PRIVATE),
     * whether search engines may index the feed, the number of published events and the audiences
     * used by them.
     */
    private function serializeFeed(CalendarFeed $feed): array
    {
        $club = $feed->getClub();

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
            'clubName' => $club->getName(),
            'timezone' => Input::canonicalTimezone($club->getTimezone()) ?? 'UTC',
            'visibility' => $feed->getVisibility()->value,
            'indexable' => $feed->isIndexable(),
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

    /**
     * Access check, window and ETag of the feed ICS without touching events: nothing but the feed, one
     * light query on the calendar versions and the clock is needed. Access (secret, archived) is always
     * decided here, before any ETag can be compared.
     *
     * @param string[]|null $targetGroupIds normalized by normalizeTargetGroupIds()
     */
    public function prepareFeedIcs(string $feedId, ?string $secret, ?array $targetGroupIds): FeedIcsPlan
    {
        $feed = $this->loadFeed($feedId, $secret);
        [$from, $to] = $this->icsWindow($feed);
        $effective = $this->effectiveTargetGroupIds($feed, $targetGroupIds);

        $versions = $this->em->getConnection()->fetchAllKeyValue(
            'SELECT id, content_version FROM calendar WHERE id IN (?) ORDER BY id',
            [$this->activeCalendarIds($feed)],
            [ArrayParameterType::STRING],
        );
        $club = $feed->getClub();
        // updated_at has second precision: the configuration fingerprint (name, visibility, secret hash,
        // selected calendars and target groups) also separates two changes within one second.
        $parts = [
            'feed' => $feed->getId(),
            'updatedAt' => $feed->getUpdatedAt()->format('U'),
            'config' => hash('sha256', json_encode([
                $feed->getName(),
                $feed->getVisibility()->value,
                $feed->getSharedSecret(),
                $this->feedTargetGroupIds($feed),
            ], JSON_THROW_ON_ERROR)),
            'calendars' => $versions,
            'filter' => $effective,
            'window' => [$from?->format('Y-m-d') ?? 'none', $to?->format('Y-m-d') ?? 'none', $this->icsMaxEvents],
            'zone' => Input::canonicalTimezone($club->getTimezone()) ?? 'UTC',
            'format' => IcsService::FORMAT_VERSION,
        ];
        $etag = substr(hash('sha256', json_encode($parts, JSON_THROW_ON_ERROR)), 0, 32);

        return new FeedIcsPlan($feed, $effective, $from, $to, $etag);
    }

    /** @return \Generator<int, string> */
    public function streamFeedIcs(FeedIcsPlan $plan): \Generator
    {
        $qb = $this->eventQuery($plan->feed, $plan->targetGroupIds, $plan->from, $plan->to);

        // FEED_ICS_MAX_EVENTS: protective cap only (first N by date, time); not a paging or sync mechanism
        return $this->icsService->streamFeedIcs(
            $plan->feed->getClub(),
            $this->icsReader->chunks($qb, $this->icsMaxEvents > 0 ? $this->icsMaxEvents : null),
        );
    }

    /**
     * ICS of one published event of the feed, rendered exactly like the feed ICS. Access and 404 rules as
     * getFeedEvent(); the event is read before streaming so a missing event stays a JSON problem.
     *
     * @return array{string, \Generator<int, string>} suggested file name and the pieces
     */
    public function streamFeedEventIcs(string $feedId, string $eventId, ?string $secret): array
    {
        $feed = $this->loadFeed($feedId, $secret);
        $qb = $this->eventQuery($feed, null, null, null)
            ->andWhere('e.id = :eventId')
            ->setParameter('eventId', $eventId);
        $events = [];
        foreach ($this->icsReader->chunks($qb, 1) as $chunk) {
            $events = $chunk;
            break;
        }
        if ([] === $events) {
            throw new NotFoundHttpException('Event not found');
        }
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtr(mb_strtolower($events[0]->name), ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss'])), '-');
        $filename = 'event-'.('' !== $slug ? substr($slug, 0, 60) : 'termin').'.ics';

        return [$filename, $this->icsService->streamFeedIcs($feed->getClub(), [$events])];
    }

    public function icsOutput(\Generator $pieces): \Closure
    {
        return $this->icsService->outputCallback($pieces);
    }

    /**
     * `targetGroupIds` query value: trimmed, empty entries dropped, de-duplicated, sorted; null when
     * nothing is left (no filter).
     *
     * @return string[]|null
     */
    public static function normalizeTargetGroupIds(mixed $param): ?array
    {
        if (!is_string($param) || '' === $param) {
            return null;
        }
        $ids = array_values(array_unique(array_filter(array_map('trim', explode(',', $param)), fn (string $id) => '' !== $id)));
        sort($ids, SORT_STRING);

        return [] === $ids ? null : $ids;
    }

    /** @return string[] sorted */
    private function feedTargetGroupIds(CalendarFeed $feed): array
    {
        $ids = $feed->getTargetGroups()->map(fn ($ftg) => $ftg->getTargetGroup()->getId())->getValues();
        sort($ids, SORT_STRING);

        return $ids;
    }

    /**
     * The target group set a query really filters by (same rule as restrictToFeed): the requested ids
     * cut with the feed's own; null = no filter. An empty array means nothing may be shown.
     *
     * @param string[]|null $targetGroupIds
     *
     * @return string[]|null
     */
    private function effectiveTargetGroupIds(CalendarFeed $feed, ?array $targetGroupIds): ?array
    {
        $feedIds = $this->feedTargetGroupIds($feed);
        if ([] === $feedIds) {
            return $targetGroupIds;
        }
        if (null === $targetGroupIds) {
            return $feedIds;
        }
        $effective = array_values(array_intersect($targetGroupIds, $feedIds));
        sort($effective, SORT_STRING);

        return $effective;
    }

    /**
     * Default window of the public ICS (FEED_ICS_*): from today minus N days to today plus M months, days in the
     * club's zone (as the web view), so the start is stable for a whole day. [null, null] when disabled.
     *
     * @return array{0: ?\DateTimeImmutable, 1: ?\DateTimeImmutable}
     */
    private function icsWindow(CalendarFeed $feed): array
    {
        if (!$this->icsWindowEnabled) {
            return [null, null];
        }
        $zone = new \DateTimeZone(Input::canonicalTimezone($feed->getClub()->getTimezone()) ?? 'UTC');
        $today = new \DateTimeImmutable('today', $zone);
        // Date-only values: compared as DATE, time and zone of the object do not matter
        $from = $today->modify(sprintf('-%d days', $this->icsPastDays));
        $to = $today->modify(sprintf('+%d months', $this->icsFutureMonths));

        return [$from, $to];
    }

    private function loadFeed(string $feedId, ?string $secret): CalendarFeed
    {
        $feed = $this->em->getRepository(CalendarFeed::class)->find($feedId);
        if (!$feed) {
            throw new NotFoundHttpException('Feed not found');
        }

        // Private feed: check the secret first, so that nothing about the feed (e.g. that its calendar
        // is archived) is revealed without access. PUBLIC and CLUB need no secret.
        if ($feed->getVisibility()->requiresSecret()) {
            if (!$secret || !hash_equals($feed->getSharedSecret(), $secret)) {
                throw new AccessDeniedHttpException('Invalid or missing secret');
            }
        }

        // No active (non-archived) calendar → 404
        if ([] === $this->activeCalendars($feed)) {
            throw new NotFoundHttpException('Feed not found');
        }

        // Access granted: tell FeedResponseHeadersListener whether the response may be indexed (the
        // listener does not load the feed again; without this attribute it sends noindex).
        $this->requestStack->getMainRequest()?->attributes->set(FeedResponseHeadersListener::INDEXABLE_ATTRIBUTE, $feed->isIndexable());

        return $feed;
    }

    private function eventQuery(CalendarFeed $feed, ?array $targetGroupIds, ?\DateTimeImmutable $from, ?\DateTimeImmutable $to): QueryBuilder
    {
        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC')
            ->addOrderBy('e.id', 'ASC');
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
     * Runs an event query for the JSON web view and loads the location and the assignments of all events in
     * batches (one query per association instead of one per event). The ICS does not use entities (IcsEventReader).
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
            ->getValues();

        $qb->andWhere('e.calendar IN (:calendars)')
            ->andWhere('e.isDraft = false')
            ->setParameter('calendars', $this->activeCalendars($feed));

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
            'note' => $e->getNote(),
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
            ])->getValues(),
            'features' => $e->getFeatures()->map(fn ($ef) => [
                'featureId' => $ef->getFeature()->getId(),
                'feature' => [
                    'id' => $ef->getFeature()->getId(),
                    'name' => $ef->getFeature()->getName(),
                ],
            ])->getValues(),
            'targetGroups' => $e->getTargetGroups()->map(fn ($etg) => [
                'targetGroupId' => $etg->getTargetGroup()->getId(),
                'targetGroup' => [
                    'id' => $etg->getTargetGroup()->getId(),
                    'name' => $etg->getTargetGroup()->getName(),
                ],
            ])->getValues(),
        ];
    }
}
