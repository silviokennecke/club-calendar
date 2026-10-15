<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class FeedService
{
    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
    ) {
    }

    public function list(Calendar $calendar, bool $includeSecret = false): array
    {
        $items = $this->em->getRepository(CalendarFeed::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (CalendarFeed $f) => $this->serialize($f, $includeSecret), $items);
    }

    /** One feed of the calendar (a feed of another calendar is 404, like an unknown id). */
    public function get(string $id, Calendar $calendar, bool $includeSecret = false): array
    {
        return $this->serialize($this->find($id, $calendar), $includeSecret);
    }

    public function create(Calendar $calendar, array $data, bool $includeSecret = false): array
    {
        $feed = new CalendarFeed();
        $feed->setCalendar($calendar);
        $feed->setName(Input::string($data, 'name'));
        // Optional: new feeds are CLUB ("Nur per Link") unless told otherwise
        if (array_key_exists('visibility', $data)) {
            $feed->setVisibility($this->visibility($data));
        }
        $this->applySearchable($feed, $data);
        // Every feed gets a secret (only PRIVATE feeds require it; switching to PRIVATE later needs one)
        $feed->setSharedSecret(bin2hex(random_bytes(16)));
        $this->em->persist($feed);
        $this->syncTargetGroups($feed, $calendar, $data);
        $this->em->flush();

        return $this->serialize($feed, $includeSecret);
    }

    public function update(string $id, Calendar $calendar, array $data, bool $includeSecret = false): array
    {
        $feed = $this->find($id, $calendar);

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
        $this->applySearchable($feed, $data);
        if (array_key_exists('targetGroupIds', $data)) {
            $this->syncTargetGroups($feed, $calendar, $data);
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

    /**
     * The search engine opt-in exists only for PUBLIC feeds: `searchable: true` for another (resulting)
     * visibility is 422; a feed that is no longer PUBLIC loses the option automatically (also when only
     * the visibility is changed), so the stored and returned value is always the effective one.
     */
    private function applySearchable(CalendarFeed $feed, array $data): void
    {
        if (array_key_exists('searchable', $data)) {
            $searchable = Input::bool($data, 'searchable');
            if ($searchable && FeedVisibility::PUBLIC !== $feed->getVisibility()) {
                throw Input::invalid('searchable', 'searchable is only allowed for PUBLIC feeds', 422);
            }
            $feed->setSearchable($searchable);
        }
        if (FeedVisibility::PUBLIC !== $feed->getVisibility()) {
            $feed->setSearchable(false);
        }
    }

    public function delete(string $id, Calendar $calendar): void
    {
        $feed = $this->find($id, $calendar);
        $this->em->remove($feed);
        $this->em->flush();
    }

    public function regenerateSecret(string $id, Calendar $calendar, bool $includeSecret = false): array
    {
        $feed = $this->find($id, $calendar);
        $feed->setSharedSecret(bin2hex(random_bytes(16)));
        $this->em->flush();

        return $this->serialize($feed, $includeSecret);
    }

    private function find(string $id, Calendar $calendar): CalendarFeed
    {
        $feed = $this->em->getRepository(CalendarFeed::class)->find($id);
        if (!$feed || $feed->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Feed not found');
        }

        return $feed;
    }

    private function syncTargetGroups(CalendarFeed $feed, Calendar $calendar, array $data): void
    {
        $groups = $this->references->findAll(TargetGroup::class, $calendar, Input::idList($data, 'targetGroupIds'), 'targetGroupIds');
        LinkCollectionSync::sync(
            $this->em,
            $feed->getTargetGroups(),
            array_keys($groups),
            fn (CalendarFeedTargetGroup $ftg) => $ftg->getTargetGroup()->getId(),
            fn (string $id) => (new CalendarFeedTargetGroup())->setFeed($feed)->setTargetGroup($groups[$id]),
        );
    }

    /** The secret leaves the API only on request (`includeSecret`), never by default. */
    public function serialize(CalendarFeed $feed, bool $includeSecret = false): array
    {
        $data = [
            'id' => $feed->getId(),
            'calendarId' => $feed->getCalendar()->getId(),
            'name' => $feed->getName(),
            'visibility' => $feed->getVisibility()->value,
            'searchable' => $feed->isSearchable(),
            'indexable' => $feed->isIndexable(),
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
