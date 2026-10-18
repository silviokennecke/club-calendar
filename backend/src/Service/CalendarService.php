<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Club;
use App\Entity\EventTemplate;
use App\Entity\EventTemplateFeature;
use App\Entity\EventTemplateProperty;
use App\Entity\EventTemplateTargetGroup;
use App\Entity\Feature;
use App\Entity\Location;
use App\Entity\Property;
use App\Entity\TargetGroup;
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

    public function deleteCalendar(Calendar $calendar): void
    {
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

        // Map old IDs to new entities
        $propMap = [];
        $featureMap = [];
        $tgMap = [];
        $locMap = [];

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

        foreach ($source->getTargetGroups() as $tg) {
            $n = new TargetGroup();
            $n->setCalendar($newCal);
            $n->setName($tg->getName());
            $this->em->persist($n);
            $tgMap[$tg->getId()] = $n;
        }

        foreach ($source->getLocations() as $loc) {
            $n = new Location();
            $n->setCalendar($newCal);
            $n->setName($loc->getName());
            $n->setStreet($loc->getStreet());
            $n->setZip($loc->getZip());
            $n->setCity($loc->getCity());
            $n->setCountry($loc->getCountry());
            $n->setLatitude($loc->getLatitude());
            $n->setLongitude($loc->getLongitude());
            $this->em->persist($n);
            $locMap[$loc->getId()] = $n;
        }

        foreach ($source->getTemplates() as $tmpl) {
            $n = new EventTemplate();
            $n->setCalendar($newCal);
            $n->setName($tmpl->getName());
            $n->setTimezone($tmpl->getTimezone());
            $n->setTimeBegin($tmpl->getTimeBegin());
            $n->setTimeEnd($tmpl->getTimeEnd());
            $oldLocId = $tmpl->getLocation()?->getId();
            if (null !== $oldLocId && isset($locMap[$oldLocId])) {
                $n->setLocation($locMap[$oldLocId]);
            }
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
                $oldId = $ttg->getTargetGroup()->getId();
                if (isset($tgMap[$oldId])) {
                    $pivot = new EventTemplateTargetGroup();
                    $pivot->setTemplate($n);
                    $pivot->setTargetGroup($tgMap[$oldId]);
                    $this->em->persist($pivot);
                }
            }
        }

        foreach ($source->getFeeds() as $feed) {
            $n = new CalendarFeed();
            $n->setCalendar($newCal);
            $n->setName($feed->getName());
            // Same status, but never indexable (no second indexed copy of the same events) and a new secret
            $n->setVisibility($feed->getVisibility());
            $n->setSearchable(false);
            $n->setSharedSecret(bin2hex(random_bytes(16)));
            $this->em->persist($n);

            foreach ($feed->getTargetGroups() as $ftg) {
                $oldId = $ftg->getTargetGroup()->getId();
                if (isset($tgMap[$oldId])) {
                    $pivot = new CalendarFeedTargetGroup();
                    $pivot->setFeed($n);
                    $pivot->setTargetGroup($tgMap[$oldId]);
                    $this->em->persist($pivot);
                }
            }
        }

        $this->em->flush();

        return $this->serializeCalendar($newCal);
    }

    /**
     * Counters: precomputed for a list (UsageCounts::byCalendar), else counted for this calendar.
     *
     * @param array{events: array<string, int>, templates: array<string, int>, feeds: array<string, int>}|null $counts
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
        ];
    }
}
