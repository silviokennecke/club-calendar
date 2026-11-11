<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedCalendar;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Club;
use App\Entity\FeedMember;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class FeedService
{
    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
        private Quota $quota,
        private UsageCounts $counts,
    ) {
    }

    public function list(Club $club, bool $includeSecret = false): array
    {
        $items = $this->em->getRepository(CalendarFeed::class)->findBy(['club' => $club]);

        $assigned = $this->counts->membersByFeed(array_map(fn (CalendarFeed $f) => $f->getId(), $items));

        return array_map(fn (CalendarFeed $f) => $this->serialize($f, $includeSecret, $assigned[$f->getId()] ?? 0), $items);
    }

    /** One feed of the club (a feed of another club is 404, like an unknown id). */
    public function get(string $id, Club $club, bool $includeSecret = false): array
    {
        return $this->serialize($this->find($id, $club), $includeSecret);
    }

    public function create(Club $club, array $data, bool $includeSecret = false): array
    {
        $this->quota->assertRoom(Quota::FEEDS_PER_CLUB, $club);
        $feed = new CalendarFeed();
        $feed->setClub($club);
        $feed->setName(Input::string($data, 'name'));
        // Optional: new feeds are CLUB ("Vereinsintern") unless told otherwise
        if (array_key_exists('visibility', $data)) {
            $feed->setVisibility($this->visibility($data));
        }
        // Every feed gets a secret (only PRIVATE feeds require it; switching to PRIVATE later needs one)
        $feed->setSharedSecret(bin2hex(random_bytes(16)));
        $calendarIds = $this->calendarIds($data);
        $this->em->persist($feed);
        $this->syncCalendars($feed, $club, $calendarIds);
        $this->syncTargetGroups($feed, $club, $data);
        $this->em->flush();

        return $this->serialize($feed, $includeSecret);
    }

    public function update(string $id, Club $club, array $data, bool $includeSecret = false): array
    {
        $feed = $this->find($id, $club);

        if (array_key_exists('name', $data)) {
            $feed->setName(Input::string($data, 'name'));
        }
        if (array_key_exists('visibility', $data)) {
            $wasProtected = $feed->getVisibility()->requiresSecret();
            $feed->setVisibility($this->visibility($data));
            // Becoming PRIVATE again: always a new secret. The old one may have spread while the feed was
            // open (shared links, logs, browser history) and must not grant access again.
            if (!$wasProtected && $feed->getVisibility()->requiresSecret()) {
                $feed->setSharedSecret(bin2hex(random_bytes(16)));
            }
        }
        if (array_key_exists('targetGroupIds', $data)) {
            $this->syncTargetGroups($feed, $club, $data);
        }
        if (array_key_exists('calendarIds', $data)) {
            $this->syncCalendars($feed, $club, $this->calendarIds($data));
        }

        $this->em->flush();

        return $this->serialize($feed, $includeSecret);
    }

    private function visibility(array $data): FeedVisibility
    {
        $value = $data['visibility'] ?? null;
        if (null === $value || '' === $value) {
            throw Input::invalid('visibility', 'visibility is required');
        }
        $visibility = is_string($value) ? FeedVisibility::tryFrom($value) : null;
        if (null === $visibility) {
            throw Input::invalid('visibility', 'visibility must be PUBLIC, CLUB or PRIVATE');
        }

        return $visibility;
    }

    public function delete(string $id, Club $club): void
    {
        $feed = $this->find($id, $club);
        $this->em->remove($feed);
        $this->em->flush();
    }

    /**
     * The old secret dies either way. `$revokeClaimed` also removes the access gained by opening the feed with
     * the secret (`claimed` rows); assigned access stays.
     */
    public function regenerateSecret(string $id, Club $club, bool $includeSecret = false, bool $revokeClaimed = false): array
    {
        $feed = $this->find($id, $club);
        $feed->setSharedSecret(bin2hex(random_bytes(16)));
        if ($revokeClaimed) {
            $this->em->createQuery('DELETE FROM '.FeedMember::class.' m WHERE m.feed = :feed AND m.source = :source')
                ->setParameter('feed', $feed)
                ->setParameter('source', FeedMember::CLAIMED)
                ->execute();
        }
        $this->em->flush();

        return $this->serialize($feed, $includeSecret);
    }

    private function find(string $id, Club $club): CalendarFeed
    {
        $feed = $this->em->getRepository(CalendarFeed::class)->find($id);
        if (!$feed || $feed->getClub()->getId() !== $club->getId()) {
            throw new NotFoundHttpException('Feed not found');
        }

        return $feed;
    }

    /** Non-empty unique list of calendar ids (absent counts as empty). */
    private function calendarIds(array $data): array
    {
        $ids = Input::idList($data, 'calendarIds');
        if ([] === $ids) {
            throw Input::invalid('calendarIds', 'calendarIds must contain at least one calendar', 422);
        }

        return $ids;
    }

    /** @param list<string> $ids calendars of the club (archived ones are fine) */
    private function syncCalendars(CalendarFeed $feed, Club $club, array $ids): void
    {
        $calendars = [];
        foreach ($ids as $id) {
            $calendar = $this->em->getRepository(Calendar::class)->find($id);
            if (null === $calendar || $calendar->getClub()->getId() !== $club->getId()) {
                throw CalendarReferences::unknown('calendarIds', $id);
            }
            $calendars[$calendar->getId()] = $calendar;
        }
        LinkCollectionSync::sync(
            $this->em,
            $feed->getCalendars(),
            array_keys($calendars),
            fn (CalendarFeedCalendar $fc) => $fc->getCalendar()->getId(),
            fn (string $id) => (new CalendarFeedCalendar())->setFeed($feed)->setCalendar($calendars[$id]),
        );
    }

    private function syncTargetGroups(CalendarFeed $feed, Club $club, array $data): void
    {
        $groups = $this->references->findAll(TargetGroup::class, $club, Input::idList($data, 'targetGroupIds'), 'targetGroupIds');
        LinkCollectionSync::sync(
            $this->em,
            $feed->getTargetGroups(),
            array_keys($groups),
            fn (CalendarFeedTargetGroup $ftg) => $ftg->getTargetGroup()->getId(),
            fn (string $id) => (new CalendarFeedTargetGroup())->setFeed($feed)->setTargetGroup($groups[$id]),
        );
    }

    /** @return list<string> */
    private static function sortedIds(CalendarFeed $feed): array
    {
        $ids = $feed->getCalendars()->map(fn (CalendarFeedCalendar $fc) => $fc->getCalendar()->getId())->getValues();
        sort($ids);

        return $ids;
    }

    /** The secret leaves the API only on request (`includeSecret`), never by default. */
    public function serialize(CalendarFeed $feed, bool $includeSecret = false, ?int $memberCount = null): array
    {
        $data = [
            'id' => $feed->getId(),
            'clubId' => $feed->getClub()->getId(),
            'calendarIds' => self::sortedIds($feed),
            'name' => $feed->getName(),
            'visibility' => $feed->getVisibility()->value,
            'indexable' => $feed->isIndexable(),
            'assignedCount' => $memberCount ?? ($this->counts->membersByFeed([$feed->getId()])[$feed->getId()] ?? 0),
            'targetGroups' => $feed->getTargetGroups()->map(fn (CalendarFeedTargetGroup $ftg) => [
                'feedId' => $ftg->getFeed()->getId(),
                'targetGroupId' => $ftg->getTargetGroup()->getId(),
            ])->getValues(),
        ];
        if ($includeSecret) {
            $data['sharedSecret'] = $feed->getSharedSecret();
        }

        return $data;
    }
}
