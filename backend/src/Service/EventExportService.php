<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\TargetGroup;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Mapping\ClassMetadata;
use Symfony\Component\HttpFoundation\HeaderUtils;

/**
 * ICS download of a calendar's events for its members (`GET /api/calendars/{id}/events.ics`), built by
 * IcsService like the feeds (VTIMEZONE, property icons, Apple location). Unlike a feed it can contain
 * drafts (STATUS:TENTATIVE).
 */
readonly class EventExportService
{
    /** Most target group ids per request (each one is checked against the calendar). */
    public const MAX_TARGET_GROUPS = 100;

    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
        private IcsService $ics,
    ) {
    }

    /**
     * @param mixed $from           YYYY-MM-DD or null (events ending on or after it, overlap like the event list)
     * @param mixed $to             YYYY-MM-DD or null (events starting on or before it)
     * @param mixed $includeDrafts  "1"/"true" or "0"/"false" (default: published only)
     * @param mixed $targetGroupIds list of ids of this calendar (or comma-separated), events with one of them
     */
    public function export(Calendar $calendar, mixed $from, mixed $to, mixed $includeDrafts, mixed $targetGroupIds): string
    {
        $fromDate = Input::optionalDate($from, 'from');
        $toDate = Input::optionalDate($to, 'to');
        Input::assertDateRange($fromDate, $toDate);
        $drafts = match ($includeDrafts) {
            null, '', '0', 'false' => false,
            '1', 'true' => true,
            default => throw Input::invalid('includeDrafts', 'includeDrafts must be true or false'),
        };
        $groupIds = $this->targetGroupIds($calendar, $targetGroupIds);

        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->where('e.calendar = :calendar')
            ->setParameter('calendar', $calendar)
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC');
        if (!$drafts) {
            $qb->andWhere('e.isDraft = false');
        }
        if (null !== $fromDate) {
            $qb->andWhere('COALESCE(e.dateEnd, e.date) >= :from')->setParameter('from', $fromDate, Types::DATE_IMMUTABLE);
        }
        if (null !== $toDate) {
            $qb->andWhere('e.date <= :to')->setParameter('to', $toDate, Types::DATE_IMMUTABLE);
        }
        if ([] !== $groupIds) {
            $qb->andWhere('EXISTS (SELECT etg FROM App\Entity\EventTargetGroup etg WHERE etg.event = e AND etg.targetGroup IN (:tgIds))')
                ->setParameter('tgIds', $groupIds);
        }

        // Location and assignments of all events in one query per association (no N+1)
        $query = $qb->getQuery();
        foreach (['location', 'properties', 'features', 'targetGroups'] as $association) {
            $query->setFetchMode(Event::class, $association, ClassMetadata::FETCH_EAGER);
        }

        return $this->ics->buildCalendarIcs($calendar->getClub(), $query->getResult());
    }

    /** `attachment` with a file name from the calendar name ("schiessbetrieb-2026.ics", like the frontend). */
    public function contentDisposition(Calendar $calendar): string
    {
        $name = $calendar->getName();
        if (class_exists(\Normalizer::class)) {
            $name = (string) \Normalizer::normalize($name, \Normalizer::FORM_KD);
        }
        $slug = strtolower((string) preg_replace('/\p{Mn}+/u', '', str_replace('ß', 'ss', $name)));
        $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', $slug), '-');

        return HeaderUtils::makeDisposition(HeaderUtils::DISPOSITION_ATTACHMENT, ('' !== $slug ? substr($slug, 0, 100) : 'termine').'.ics');
    }

    /**
     * @return list<string>
     */
    private function targetGroupIds(Calendar $calendar, mixed $value): array
    {
        if (null === $value || '' === $value) {
            return [];
        }
        if (is_string($value)) {
            $value = array_values(array_filter(array_map('trim', explode(',', $value)), fn ($id) => '' !== $id));
        }
        if (!is_array($value)) {
            throw Input::invalid('targetGroupIds', 'targetGroupIds must be a list of ids');
        }
        $ids = Input::idList(['targetGroupIds' => array_values($value)], 'targetGroupIds');
        if (count($ids) > self::MAX_TARGET_GROUPS) {
            throw Input::invalid('targetGroupIds', sprintf('At most %d target groups', self::MAX_TARGET_GROUPS));
        }

        // Only target groups of this calendar (unknown and foreign ids alike → 422)
        return array_keys($this->references->findAll(TargetGroup::class, $calendar->getClub(), $ids, 'targetGroupIds'));
    }
}
