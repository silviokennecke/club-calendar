<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Club;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Entity\User;
use App\Enum\ClubRole;
use App\EventListener\FeedResponseHeadersListener;
use App\Ics\IcsEventReader;
use App\Repository\HolidayEventRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\QueryBuilder;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Serves the personal subscription ("Mein Abo"): the public ICS behind the secret address and the signed-in
 * calendar view. Both work on the EFFECTIVE feeds: the selected feeds the member may access right now (re-evaluated
 * on every request, so a revoked assignment or a demotion takes effect at once), each with its own calendars and
 * target group filter, united into one event set (an event in several feeds appears once).
 *
 * The ICS path reads the selection with three light queries and no entities; the ETag is decided from that alone.
 */
class PersonalFeedService
{
    public const CALENDAR_NAME_SUFFIX = ' – Mein Abo';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly PublicFeedService $feeds,
        private readonly IcsService $icsService,
        private readonly IcsEventReader $icsReader,
        private readonly HolidayEventRepository $holidays,
        private readonly RequestStack $requestStack,
    ) {
    }

    /**
     * Access check, window and ETag of the personal ICS without touching events. Unknown id, wrong or missing secret
     * and a member who is gone are the same 404; the secret is compared right after the first lookup.
     */
    public function prepareIcs(string $subscriptionId, mixed $secret): PersonalIcsPlan
    {
        $row = $this->subscriptionRow('s.id = :id', ['id' => $subscriptionId]);
        if (null === $row || !is_string($secret) || '' === $secret || !hash_equals($row['secret'], $secret) || null === $row['role']) {
            throw new NotFoundHttpException('Subscription not found');
        }
        // Whatever the answer, a personal address is never indexable (the listener sends noindex without the attribute)
        $this->requestStack->getMainRequest()?->attributes->set(FeedResponseHeadersListener::INDEXABLE_ATTRIBUTE, false);

        $selection = $this->selection($row);
        [$from, $to] = $this->feeds->windowForZone($selection->timezone);
        $requested = $selection->targetGroupIds ?: null;
        $branches = $selection->branches($requested);

        $parts = [
            'sub' => $selection->subscriptionId,
            'updatedAt' => $row['updated_at'],
            'config' => hash('sha256', json_encode([$row['secret'], $selection->targetGroupIds], JSON_THROW_ON_ERROR)),
            'club' => [$selection->clubName, $selection->timezone],
            'feeds' => array_map(fn (array $f) => [
                $f['id'],
                $f['updatedAt'],
                hash('sha256', json_encode([$f['name'], $f['visibility'], $f['secret'], $f['groups']], JSON_THROW_ON_ERROR)),
                $selection->effectiveGroups($f['groups'], $requested),
            ], $selection->feeds),
            'calendars' => $selection->versions,
            'window' => [$from?->format('Y-m-d') ?? 'none', $to?->format('Y-m-d') ?? 'none', $this->feeds->maxIcsEvents()],
            'format' => IcsService::FORMAT_VERSION,
        ];
        $etag = substr(hash('sha256', json_encode($parts, JSON_THROW_ON_ERROR)), 0, 32);

        return new PersonalIcsPlan($selection, $requested, [] !== $branches, $from, $to, $etag);
    }

    /** @return \Generator<int, string> */
    public function streamIcs(PersonalIcsPlan $plan): \Generator
    {
        $chunks = [];
        if ($plan->hasEvents) {
            $qb = $this->baseQuery($plan->selection, $plan->targetGroupIds, $plan->from, $plan->to);
            $max = $this->feeds->maxIcsEvents();
            $chunks = $this->icsReader->chunks($qb, $max > 0 ? $max : null);
        }

        return $this->icsService->streamFeedIcsForZone(
            $plan->selection->timezone,
            $chunks,
            $plan->selection->clubName.self::CALENDAR_NAME_SUFFIX,
        );
    }

    public function icsOutput(\Generator $pieces): \Closure
    {
        return $this->icsService->outputCallback($pieces);
    }

    /** The member's current selection (empty when the subscription does not exist yet). */
    public function forMember(User $user, Club $club): PersonalSelection
    {
        $row = $this->subscriptionRow('s.user_id = :user AND s.club_id = :club', ['user' => $user->getId(), 'club' => $club->getId()]);
        if (null === $row || null === $row['role']) {
            return new PersonalSelection(null, $club->getId(), $club->getName(), $club->getTimezone(), [], [], []);
        }

        return $this->selection($row);
    }

    /**
     * Web view of the effective feeds, shaped like the public feed's `/events` answer. `$targetGroupIds` null =
     * the subscription's own selection, a list (possibly empty = all groups) overrides it.
     *
     * @param string[]|null $targetGroupIds
     *
     * @return array<string, mixed>
     */
    public function getEvents(PersonalSelection $selection, ?array $targetGroupIds, mixed $from, mixed $to): array
    {
        $fromDate = Input::optionalDate($from, 'from');
        $toDate = Input::optionalDate($to, 'to');
        Input::assertDateRange($fromDate, $toDate);
        $requested = (null === $targetGroupIds ? $selection->targetGroupIds : $targetGroupIds) ?: null;

        $events = [] === $selection->branches($requested)
            ? []
            : $this->feeds->fetchEvents($this->baseQuery($selection, $requested, $fromDate, $toDate));
        $calendarIds = $selection->calendarIds();
        $holidays = [] === $calendarIds ? [] : $this->feeds->dedupeHolidays($this->holidays->findByCalendars($calendarIds, $fromDate, $toDate));

        return [
            'feed' => $this->header($selection),
            'events' => array_map($this->feeds->serializeEvent(...), $events),
            'holidays' => array_map($this->feeds->serializeHoliday(...), $holidays),
        ];
    }

    /** @return array<string, mixed> */
    public function getEvent(PersonalSelection $selection, string $eventId): array
    {
        $event = null;
        if ([] !== $selection->branches(null)) {
            $event = $this->baseQuery($selection, null, null, null)
                ->andWhere('e.id = :eventId')
                ->setParameter('eventId', $eventId)
                ->getQuery()
                ->getOneOrNullResult();
        }
        if (!$event instanceof Event) {
            throw new NotFoundHttpException('Event not found');
        }

        return ['feed' => $this->header($selection), 'event' => $this->feeds->serializeEvent($event)];
    }

    /** @return array<string, mixed> */
    private function header(PersonalSelection $selection): array
    {
        $count = 0;
        $audiences = [];
        if ([] !== $selection->branches(null)) {
            $countQb = $this->em->createQueryBuilder()->select('COUNT(e.id)')->from(Event::class, 'e');
            $this->restrict($countQb, $selection, null);
            $count = (int) $countQb->getQuery()->getSingleScalarResult();
            $groupQb = $this->em->createQueryBuilder()
                ->select('DISTINCT tg.id AS id', 'tg.name AS name')
                ->from(EventTargetGroup::class, 'etg')
                ->join('etg.event', 'e')
                ->join('etg.targetGroup', 'tg')
                ->orderBy('tg.name', 'ASC');
            $this->restrict($groupQb, $selection, null);
            $audiences = array_map(
                fn (array $row) => ['id' => (string) $row['id'], 'name' => (string) $row['name']],
                $groupQb->getQuery()->getArrayResult(),
            );
        }

        return [
            'id' => $selection->subscriptionId ?? '',
            'name' => 'Mein Abo',
            'clubName' => $selection->clubName,
            'timezone' => Input::canonicalTimezone($selection->timezone) ?? 'UTC',
            'visibility' => 'PRIVATE',
            'indexable' => false,
            'eventCount' => $count,
            'audiences' => $audiences,
        ];
    }

    /** @param string[]|null $requested */
    private function baseQuery(PersonalSelection $selection, ?array $requested, ?\DateTimeImmutable $from, ?\DateTimeImmutable $to): QueryBuilder
    {
        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC')
            ->addOrderBy('e.id', 'ASC');
        $this->restrict($qb, $selection, $requested);
        if (null !== $from) {
            $qb->andWhere('COALESCE(e.dateEnd, e.date) >= :from')->setParameter('from', $from, Types::DATE_IMMUTABLE);
        }
        if (null !== $to) {
            $qb->andWhere('e.date <= :to')->setParameter('to', $to, Types::DATE_IMMUTABLE);
        }

        return $qb;
    }

    /** Published events of the union of the effective feeds: one OR branch per distinct target group filter. */
    private function restrict(QueryBuilder $qb, PersonalSelection $selection, ?array $requested): void
    {
        $qb->andWhere('e.isDraft = false');
        $ors = [];
        foreach ($selection->branches($requested) as $i => [$calendarIds, $groups]) {
            $cond = "e.calendar IN (:cal$i)";
            $qb->setParameter("cal$i", $calendarIds);
            if (null !== $groups) {
                $cond .= " AND EXISTS (SELECT vetg$i FROM App\\Entity\\EventTargetGroup vetg$i WHERE vetg$i.event = e AND vetg$i.targetGroup IN (:tg$i))";
                $qb->setParameter("tg$i", $groups);
            }
            $ors[] = "($cond)";
        }
        $qb->andWhere([] === $ors ? '1 = 0' : implode(' OR ', $ors));
    }

    /**
     * @param array<string, scalar> $params
     *
     * @return array{id: string, secret: string, updated_at: string, user_id: string, club_id: string, club_name: string, timezone: string, role: ?string}|null
     */
    private function subscriptionRow(string $condition, array $params): ?array
    {
        $row = $this->em->getConnection()->fetchAssociative(
            'SELECT s.id, s.secret, s.updated_at, s.user_id, s.club_id, c.name AS club_name, c.timezone, cu.role
             FROM member_subscription s
             JOIN club c ON c.id = s.club_id
             LEFT JOIN club_user cu ON cu.club_id = s.club_id AND cu.user_id = s.user_id
             WHERE '.$condition,
            $params,
        );

        return false === $row ? null : $row;
    }

    /**
     * Selected feeds that are accessible now (same rule as FeedAccessPolicy) and have an active calendar, their
     * calendars with content versions, filters, and the subscription's own target groups: two queries.
     *
     * @param array<string, mixed> $row
     */
    private function selection(array $row): PersonalSelection
    {
        $conn = $this->em->getConnection();
        $staff = ClubRole::tryFrom((string) $row['role'])?->isStaff() ?? false;
        $feedRows = $conn->fetchAllAssociative(
            "SELECT f.id, f.name, f.visibility, f.shared_secret, f.updated_at
             FROM member_subscription_feed msf
             JOIN calendar_feed f ON f.id = msf.feed_id
             WHERE msf.subscription_id = :sid AND f.club_id = :club
               AND (f.visibility <> 'PRIVATE' OR :staff = 1
                    OR EXISTS (SELECT 1 FROM feed_member fm WHERE fm.feed_id = f.id AND fm.user_id = :uid))
             ORDER BY f.id",
            ['sid' => $row['id'], 'club' => $row['club_id'], 'staff' => $staff ? 1 : 0, 'uid' => $row['user_id']],
        );
        $related = $conn->fetchAllAssociative(
            "SELECT 'cal' AS k, fc.feed_id AS a, c.id AS b, c.content_version AS v
               FROM member_subscription_feed msf
               JOIN calendar_feed_calendar fc ON fc.feed_id = msf.feed_id
               JOIN calendar c ON c.id = fc.calendar_id
              WHERE msf.subscription_id = :sid AND c.archived_at IS NULL
             UNION ALL
             SELECT 'ftg', ftg.feed_id, ftg.target_group_id, ''
               FROM member_subscription_feed msf
               JOIN calendar_feed_target_group ftg ON ftg.feed_id = msf.feed_id
              WHERE msf.subscription_id = :sid
             UNION ALL
             SELECT 'stg', '', stg.target_group_id, ''
               FROM member_subscription_target_group stg
              WHERE stg.subscription_id = :sid",
            ['sid' => $row['id']],
        );

        $calendars = $feedGroups = $subGroups = $versions = [];
        foreach ($related as $r) {
            switch ($r['k']) {
                case 'cal':
                    $calendars[$r['a']][] = $r['b'];
                    $versions[$r['b']] = (string) $r['v'];
                    break;
                case 'ftg':
                    $feedGroups[$r['a']][] = $r['b'];
                    break;
                default:
                    $subGroups[] = $r['b'];
            }
        }
        sort($subGroups, SORT_STRING);

        $feeds = [];
        $used = [];
        foreach ($feedRows as $f) {
            if (!isset($calendars[$f['id']])) {
                continue;
            }
            $groups = $feedGroups[$f['id']] ?? [];
            sort($groups, SORT_STRING);
            $cals = $calendars[$f['id']];
            sort($cals, SORT_STRING);
            $feeds[] = [
                'id' => $f['id'],
                'name' => $f['name'],
                'visibility' => $f['visibility'],
                'secret' => $f['shared_secret'],
                'updatedAt' => $f['updated_at'],
                'groups' => $groups,
                'calendars' => $cals,
            ];
            foreach ($cals as $c) {
                $used[$c] = $versions[$c];
            }
        }
        ksort($used, SORT_STRING);

        return new PersonalSelection($row['id'], $row['club_id'], $row['club_name'], $row['timezone'], $feeds, $subGroups, $used);
    }
}
