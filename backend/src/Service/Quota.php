<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\Event;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\HolidayCalendar;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Per-user, per-club and per-calendar quotas (security audit M7: no unbounded data growth by one account).
 * All limits live here and are deliberately generous; reaching one is 422 `quota_exceeded` with the
 * `resource` and the `limit` in the problem body. The check is a count before the write, so two parallel
 * requests can overshoot a limit by the batch size; that is accepted (the limits protect against runaway
 * growth, not against an exact number).
 *
 * Per-request caps live next to the code that enforces them: SeriesRule::MAX_EVENTS (366 per series),
 * EventImportService::MAX_EVENTS and EventService::BULK_MAX (5000), MAX_LIST_LIMIT and MAX_RANGE_DAYS of
 * the event list, Input::MAX_IDS (ids of one list field), HolidayCalendarService::MAX_BYTES / MAX_EVENTS.
 */
class Quota
{
    public const CODE = 'quota_exceeded';

    public const CLUBS_PER_USER = 'clubsPerUser';
    public const CALENDARS_PER_CLUB = 'calendarsPerClub';
    public const MEMBERS_PER_CLUB = 'membersPerClub';
    public const PENDING_INVITATIONS_PER_CLUB = 'pendingInvitationsPerClub';
    public const EVENTS_PER_CALENDAR = 'eventsPerCalendar';
    public const LOCATIONS_PER_CLUB = 'locationsPerClub';
    public const TEMPLATES_PER_CALENDAR = 'templatesPerCalendar';
    public const PROPERTIES_PER_CALENDAR = 'propertiesPerCalendar';
    public const FEATURES_PER_CALENDAR = 'featuresPerCalendar';
    public const TARGET_GROUPS_PER_CLUB = 'targetGroupsPerClub';
    public const FEEDS_PER_CLUB = 'feedsPerClub';
    public const HOLIDAY_CALENDARS_PER_CALENDAR = 'holidayCalendarsPerCalendar';

    /** @var array<string, int> */
    public const LIMITS = [
        self::CLUBS_PER_USER => 50,
        self::CALENDARS_PER_CLUB => 100,
        self::MEMBERS_PER_CLUB => 500,
        self::PENDING_INVITATIONS_PER_CLUB => 200,
        self::EVENTS_PER_CALENDAR => 20000,
        self::LOCATIONS_PER_CLUB => 2000,
        self::TEMPLATES_PER_CALENDAR => 500,
        self::PROPERTIES_PER_CALENDAR => 500,
        self::FEATURES_PER_CALENDAR => 500,
        self::TARGET_GROUPS_PER_CLUB => 500,
        self::FEEDS_PER_CLUB => 50,
        self::HOLIDAY_CALENDARS_PER_CALENDAR => 20,
    ];

    /** resource => [entity, owning field, optional field => value filter] */
    private const COUNTED = [
        self::CLUBS_PER_USER => [ClubUser::class, 'user'],
        self::CALENDARS_PER_CLUB => [Calendar::class, 'club'],
        self::MEMBERS_PER_CLUB => [ClubUser::class, 'club'],
        // Open invitations (also expired ones, they stay listed until revoked or pruned)
        self::PENDING_INVITATIONS_PER_CLUB => [ClubInvitation::class, 'club', ['status' => ClubInvitation::PENDING]],
        self::EVENTS_PER_CALENDAR => [Event::class, 'calendar'],
        self::LOCATIONS_PER_CLUB => [Location::class, 'club'],
        self::TEMPLATES_PER_CALENDAR => [EventTemplate::class, 'calendar'],
        self::PROPERTIES_PER_CALENDAR => [Property::class, 'calendar'],
        self::FEATURES_PER_CALENDAR => [Feature::class, 'calendar'],
        self::TARGET_GROUPS_PER_CLUB => [TargetGroup::class, 'club'],
        self::FEEDS_PER_CLUB => [CalendarFeed::class, 'club'],
        self::HOLIDAY_CALENDARS_PER_CALENDAR => [HolidayCalendar::class, 'calendar'],
    ];

    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    /**
     * Throws 422 `quota_exceeded` when `$adding` more records would exceed the limit of the resource.
     *
     * @param Club|Calendar|User $owner the club, calendar or user the records belong to
     */
    public function assertRoom(string $resource, Club|Calendar|User $owner, int $adding = 1): void
    {
        if ($adding <= 0) {
            return;
        }
        [$class, $field, $filter] = self::COUNTED[$resource] + [2 => []];
        $limit = self::LIMITS[$resource];
        $qb = $this->em->createQueryBuilder()
            ->select(sprintf('COUNT(IDENTITY(r.%s))', $field)) // COUNT(r) fails on the composite key of ClubUser
            ->from($class, 'r')
            ->where(sprintf('r.%s = :owner', $field))
            ->setParameter('owner', $owner);
        foreach ($filter as $column => $value) {
            $qb->andWhere(sprintf('r.%s = :f_%s', $column, $column))->setParameter('f_'.$column, $value);
        }
        $count = (int) $qb->getQuery()->getSingleScalarResult();
        if ($count + $adding > $limit) {
            throw new ApiProblemException(422, sprintf('Limit reached: at most %d %s', $limit, $resource), self::CODE, null, [], null, ['resource' => $resource, 'limit' => $limit]);
        }
    }
}
