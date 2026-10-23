<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedCalendar;
use App\Entity\Club;
use App\Entity\EventTemplate;
use App\Entity\EventTemplateFeature;
use App\Entity\EventTemplateProperty;
use App\Entity\EventTemplateTargetGroup;
use App\Entity\Feature;
use App\Entity\Property;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;

class CalendarService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UsageCounts $counts,
        private readonly Quota $quota,
    ) {
    }

    public function listCalendars(Club $club, bool $includeArchived = false): array
    {
        $qb = $this->em->createQueryBuilder()
            ->select('c')
            ->from(Calendar::class, 'c')
            ->where('c.club = :club')
            ->setParameter('club', $club);

        if (!$includeArchived) {
            $qb->andWhere('c.archivedAt IS NULL');
        }

        $calendars = $qb->getQuery()->getResult();

        // Sort: non-archived first (nulls first), then by name
        usort($calendars, function (Calendar $a, Calendar $b) {
            $aArchived = null !== $a->getArchivedAt();
            $bArchived = null !== $b->getArchivedAt();
            if ($aArchived !== $bArchived) {
                return $aArchived ? 1 : -1;
            }

            return strcmp($a->getName(), $b->getName());
        });

        $counts = $this->counts->byCalendar(array_map(fn (Calendar $c) => $c->getId(), $calendars));

        return array_map(fn (Calendar $c) => $this->serializeCalendar($c, $counts), $calendars);
    }

    public function createCalendar(Club $club, string $name, ?string $timezone): array
    {
        $this->quota->assertRoom(Quota::CALENDARS_PER_CLUB, $club);
        $cal = new Calendar();
        $cal->setClub($club);
        $cal->setName($name);
        $cal->setTimezone($timezone);
        $this->em->persist($cal);
        $this->em->flush();

        return $this->serializeCalendar($cal);
    }

    public function updateCalendar(Calendar $calendar, array $data): array
    {
        // Defense in depth: the route already denies archived calendars (NOT_ARCHIVED); archive/unarchive
        // use their own methods and are not affected.
        if (null !== $calendar->getArchivedAt()) {
            throw new AccessDeniedException('Calendar is archived');
        }
        if (array_key_exists('name', $data)) {
            $calendar->setName(Input::string($data, 'name'));
        }
        if (array_key_exists('timezone', $data)) {
            $calendar->setTimezone(Input::timezone($data, 'timezone'));
        }
        $this->em->flush();

        return $this->serializeCalendar($calendar);
    }

    /** Feeds that select only this calendar go with it; shared feeds lose just the link (DB cascade). */
    public function deleteCalendar(Calendar $calendar): void
    {
        $exclusive = $this->em->createQuery(
            'SELECT f FROM '.CalendarFeed::class.' f WHERE f.club = :club AND EXISTS (SELECT 1 FROM '.CalendarFeedCalendar::class.' x WHERE x.feed = f AND x.calendar = :cal)'
            .' AND NOT EXISTS (SELECT 1 FROM '.CalendarFeedCalendar::class.' y WHERE y.feed = f AND y.calendar <> :cal)',
        )->setParameter('club', $calendar->getClub())->setParameter('cal', $calendar)->getResult();
        foreach ($exclusive as $feed) {
            $this->em->remove($feed);
        }
        // The DB cascade drops the link of shared feeds; removing it through the ORM stamps those feeds' updated_at.
        foreach ($this->em->getRepository(CalendarFeedCalendar::class)->findBy(['calendar' => $calendar]) as $link) {
            if (!in_array($link->getFeed(), $exclusive, true)) {
                $this->em->remove($link);
            }
        }
        $this->em->remove($calendar);
        $this->em->flush();
    }

    public function archiveCalendar(Calendar $calendar): array
    {
        $calendar->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();

        return $this->serializeCalendar($calendar);
    }

    public function unarchiveCalendar(Calendar $calendar): array
    {
        $calendar->setArchivedAt(null);
        $this->em->flush();

        return $this->serializeCalendar($calendar);
    }

    /**
     * @param string|null $name name of the copy (the client sends it localized); default "Copy of …"
     */
    public function duplicateCalendar(Calendar $source, ?string $name = null): array
    {
        $this->quota->assertRoom(Quota::CALENDARS_PER_CLUB, $source->getClub());
        $newCal = new Calendar();
        $newCal->setClub($source->getClub());
        $newCal->setName($name ?? mb_substr('Copy of '.$source->getName(), 0, 255));
        $newCal->setTimezone($source->getTimezone());
        $this->em->persist($newCal);

        // Properties and features are calendar-level: the copy gets its own (old id => new entity)
        $propMap = [];
        $featureMap = [];
        foreach ($source->getProperties() as $p) {
            $n = new Property();
            $n->setCalendar($newCal);
            $n->setName($p->getName());
            $n->setIcon($p->getIcon());
            $this->em->persist($n);
            $propMap[$p->getId()] = $n;
        }
        foreach ($source->getFeatures() as $f) {
            $n = new Feature();
            $n->setCalendar($newCal);
            $n->setName($f->getName());
            $this->em->persist($n);
            $featureMap[$f->getId()] = $n;
        }

        foreach ($source->getTemplates() as $tmpl) {
            $n = new EventTemplate();
            $n->setCalendar($newCal);
            $n->setName($tmpl->getName());
            $n->setTimezone($tmpl->getTimezone());
            $n->setTimeBegin($tmpl->getTimeBegin());
            $n->setTimeEnd($tmpl->getTimeEnd());
            $n->setNote($tmpl->getNote());
            // Locations and target groups are club-level: the copy references the same ones
            $n->setLocation($tmpl->getLocation());
            $this->em->persist($n);

            foreach ($tmpl->getProperties() as $tp) {
                $oldId = $tp->getProperty()->getId();
                if (isset($propMap[$oldId])) {
                    $pivot = new EventTemplateProperty();
                    $pivot->setTemplate($n);
                    $pivot->setProperty($propMap[$oldId]);
                    $this->em->persist($pivot);
                }
            }
            foreach ($tmpl->getFeatures() as $tf) {
                $oldId = $tf->getFeature()->getId();
                if (isset($featureMap[$oldId])) {
                    $pivot = new EventTemplateFeature();
                    $pivot->setTemplate($n);
                    $pivot->setFeature($featureMap[$oldId]);
                    $this->em->persist($pivot);
                }
            }
            foreach ($tmpl->getTargetGroups() as $ttg) {
                $pivot = new EventTemplateTargetGroup();
                $pivot->setTemplate($n);
                $pivot->setTargetGroup($ttg->getTargetGroup());
                $this->em->persist($pivot);
            }
        }

        $this->em->flush();

        return $this->serializeCalendar($newCal);
    }

    /**
     * Counters: precomputed for a list (UsageCounts::byCalendar), else counted for this calendar.
     *
     * @param array{events: array<string, int>, templates: array<string, int>, feeds: array<string, int>, exclusiveFeeds: array<string, int>}|null $counts
     */
    public function serializeCalendar(Calendar $cal, ?array $counts = null): array
    {
        $id = $cal->getId();
        $counts ??= $this->counts->byCalendar([$id]);

        return [
            'id' => $id,
            'clubId' => $cal->getClub()->getId(),
            'name' => $cal->getName(),
            'timezone' => $cal->getTimezone(),
            'archivedAt' => $cal->getArchivedAt()?->format(\DateTimeInterface::ATOM),
            'eventCount' => $counts['events'][$id] ?? 0,
            'templateCount' => $counts['templates'][$id] ?? 0,
            'feedCount' => $counts['feeds'][$id] ?? 0,
            'exclusiveFeedCount' => $counts['exclusiveFeeds'][$id] ?? 0,
        ];
    }
}
