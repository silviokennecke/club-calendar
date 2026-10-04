<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\TargetGroup;
use App\Enum\FeedVisibility;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

readonly class FeedService
{
    public function __construct(
        private EntityManagerInterface $em,
        private CalendarReferences $references,
    ) {
    }

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(CalendarFeed::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (CalendarFeed $f) => $this->serialize($f), $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        $feed = new CalendarFeed();
        $feed->setCalendar($calendar);
        $feed->setName(Input::string($data, 'name'));
        $feed->setVisibility($this->visibility($data));
        $feed->setSharedSecret(bin2hex(random_bytes(16)));
        $this->em->persist($feed);
        $this->syncTargetGroups($feed, $calendar, $data);
        $this->em->flush();

        return $this->serialize($feed);
    }

    public function update(string $id, Calendar $calendar, array $data): array
    {
        $feed = $this->find($id, $calendar);

        if (array_key_exists('name', $data)) {
            $feed->setName(Input::string($data, 'name'));
        }
        if (array_key_exists('visibility', $data)) {
            $feed->setVisibility($this->visibility($data));
        }
        if (array_key_exists('targetGroupIds', $data)) {
            $this->syncTargetGroups($feed, $calendar, $data);
        }

        $this->em->flush();

        return $this->serialize($feed);
    }

    private function visibility(array $data): FeedVisibility
    {
        $value = $data['visibility'] ?? null;
        if (null === $value || '' === $value) {
            throw new BadRequestHttpException('visibility is required');
        }
        $visibility = is_string($value) ? FeedVisibility::tryFrom($value) : null;
        if (null === $visibility) {
            throw new BadRequestHttpException('visibility must be PUBLIC or PRIVATE');
        }

        return $visibility;
    }

    public function delete(string $id, Calendar $calendar): void
    {
        $feed = $this->find($id, $calendar);
        $this->em->remove($feed);
        $this->em->flush();
    }

    public function regenerateSecret(string $id, Calendar $calendar): array
    {
        $feed = $this->find($id, $calendar);
        $feed->setSharedSecret(bin2hex(random_bytes(16)));
        $this->em->flush();

        return $this->serialize($feed);
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

    public function serialize(CalendarFeed $feed): array
    {
        return [
            'id' => $feed->getId(),
            'calendarId' => $feed->getCalendar()->getId(),
            'name' => $feed->getName(),
            'visibility' => $feed->getVisibility()->value,
            'sharedSecret' => $feed->getSharedSecret(),
            'targetGroups' => $feed->getTargetGroups()->map(fn (CalendarFeedTargetGroup $ftg) => [
                'feedId' => $ftg->getFeed()->getId(),
                'targetGroupId' => $ftg->getTargetGroup()->getId(),
            ])->getValues(),
        ];
    }
}
