<?php

declare(strict_types=1);

namespace App\Doctrine;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\Event;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventSeries;
use App\Entity\EventTargetGroup;
use App\Entity\Feature;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
use App\Service\CalendarVersionBumper;
use Doctrine\Bundle\DoctrineBundle\Attribute\AsDoctrineListener;
use Doctrine\ORM\Event\OnFlushEventArgs;
use Doctrine\ORM\Events;

/**
 * Finds the calendars whose feed output a flush changes (onFlush) and overwrites their content_version blindly
 * afterwards (postFlush, plain SQL outside the change tracking: no flush loop, no updated_at stamp).
 *
 * Why postFlush: Doctrine commits the flush transaction before postFlush, so the new token is never visible
 * before the new content (a reader that takes the token first and the content second can at worst pair a
 * new token with old content for a moment, never the reverse). Inside an outer transaction (wrapInTransaction)
 * the UPDATE joins it and rolls back with it. If the UPDATE itself fails after the commit, the exception
 * propagates (request fails) instead of silently leaving a stale token.
 *
 * Inserts of Calendar (own token), Property/Feature/TargetGroup/Location are skipped: nothing references a new row yet. Club-scoped
 * TargetGroup/Location changes and a club time zone change bump all calendars of the club. DB-side ON DELETE CASCADE/SET NULL effects are
 * covered by the deletion of the parent row seen here; bulk DQL/SQL needs an explicit CalendarVersionBumper call.
 */
#[AsDoctrineListener(event: Events::onFlush)]
#[AsDoctrineListener(event: Events::postFlush)]
final class ContentVersionListener
{
    /** @var array<string, true> */
    private array $calendarIds = [];

    /** @var array<string, true> */
    private array $clubIds = [];

    public function __construct(private readonly CalendarVersionBumper $bumper)
    {
    }

    public function onFlush(OnFlushEventArgs $args): void
    {
        $this->calendarIds = $this->clubIds = [];
        $uow = $args->getObjectManager()->getUnitOfWork();

        foreach ($uow->getScheduledEntityInsertions() as $entity) {
            // New calendars get their token from the constructor.
            if (!$entity instanceof Calendar && !$entity instanceof Property && !$entity instanceof Feature && !$entity instanceof TargetGroup && !$entity instanceof Location) {
                $this->collect($entity);
            }
        }
        foreach ($uow->getScheduledEntityUpdates() as $entity) {
            $this->collect($entity);
            if ($entity instanceof Event) {
                $moved = $uow->getEntityChangeSet($entity)['calendar'][0] ?? null;
                if ($moved instanceof Calendar) {
                    $this->calendarIds[$moved->getId()] = true;
                }
            } elseif ($entity instanceof Club && array_key_exists('timezone', $uow->getEntityChangeSet($entity))) {
                $this->clubIds[$entity->getId()] = true;
            }
        }
        foreach ($uow->getScheduledEntityDeletions() as $entity) {
            // A deleted calendar has no token left to bump.
            if (!$entity instanceof Calendar) {
                $this->collect($entity);
            }
        }
    }

    public function postFlush(): void
    {
        $calendars = array_keys($this->calendarIds);
        $clubs = array_keys($this->clubIds);
        $this->calendarIds = $this->clubIds = [];

        $this->bumper->bumpCalendars($calendars);
        $this->bumper->bumpClubs($clubs);
    }

    private function collect(object $entity): void
    {
        $calendar = match (true) {
            $entity instanceof Calendar => $entity,
            $entity instanceof Event, $entity instanceof EventSeries, $entity instanceof Property,
            $entity instanceof Feature, $entity instanceof HolidayCalendar => $entity->getCalendar(),
            $entity instanceof EventProperty, $entity instanceof EventFeature, $entity instanceof EventTargetGroup => $entity->getEvent()->getCalendar(),
            $entity instanceof HolidayEvent => $entity->getHolidayCalendar()->getCalendar(),
            default => null,
        };
        if (null !== $calendar) {
            $this->calendarIds[$calendar->getId()] = true;

            return;
        }

        if ($entity instanceof TargetGroup || $entity instanceof Location) {
            $this->clubIds[$entity->getClub()->getId()] = true;
        }
    }
}
