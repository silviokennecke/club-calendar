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
    public function __construct(private EntityManagerInterface $em) {}

    public function list(Calendar $calendar): array
    {
        $items = $this->em->getRepository(CalendarFeed::class)->findBy(['calendar' => $calendar]);

        return array_map(fn (CalendarFeed $f) => $this->serialize($f), $items);
    }

    public function create(Calendar $calendar, array $data): array
    {
        if (empty($data['name'])) {
            throw new BadRequestHttpException('name is required');
        }
        if (empty($data['visibility'])) {
            throw new BadRequestHttpException('visibility is required');
        }

        $visibility = FeedVisibility::tryFrom($data['visibility']);
        if ($visibility === null) {
            throw new BadRequestHttpException('visibility must be PUBLIC or PRIVATE');
        }

        $feed = new CalendarFeed();
        $feed->setCalendar($calendar);
        $feed->setName($data['name']);
        $feed->setVisibility($visibility);
        $feed->setSharedSecret(bin2hex(random_bytes(16)));

        $this->em->persist($feed);
        $this->syncTargetGroups($feed, $data['targetGroupIds'] ?? [], $calendar);
        $this->em->flush();

        return $this->serialize($feed);
    }

    public function update(string $id, Calendar $calendar, array $data): array
    {
        $feed = $this->find($id, $calendar);

        if (array_key_exists('name', $data)) {
            $feed->setName($data['name']);
        }
        if (array_key_exists('visibility', $data)) {
            $visibility = FeedVisibility::tryFrom($data['visibility']);
            if ($visibility === null) {
                throw new BadRequestHttpException('visibility must be PUBLIC or PRIVATE');
            }
            $feed->setVisibility($visibility);
        }
        if (array_key_exists('targetGroupIds', $data)) {
            foreach ($feed->getTargetGroups() as $ftg) {
                $this->em->remove($ftg);
            }
            $feed->getTargetGroups()->clear();
            $this->syncTargetGroups($feed, $data['targetGroupIds'], $calendar);
        }

        $this->em->flush();

        return $this->serialize($feed);
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

    private function syncTargetGroups(CalendarFeed $feed, array $targetGroupIds, Calendar $calendar): void
    {
        foreach ($targetGroupIds as $tgid) {
            $tg = $this->em->getRepository(TargetGroup::class)->find($tgid);
            if ($tg && $tg->getCalendar()->getId() === $calendar->getId()) {
                $ftg = new CalendarFeedTargetGroup();
                $ftg->setFeed($feed);
                $ftg->setTargetGroup($tg);
                $this->em->persist($ftg);
            }
        }
    }

    public function serialize(CalendarFeed $feed): array
    {
        return [
            'id'           => $feed->getId(),
            'calendarId'   => $feed->getCalendar()->getId(),
            'name'         => $feed->getName(),
            'visibility'   => $feed->getVisibility()->value,
            'sharedSecret' => $feed->getSharedSecret(),
            'targetGroups' => $feed->getTargetGroups()->map(fn (CalendarFeedTargetGroup $ftg) => [
                'feedId'        => $ftg->getFeed()->getId(),
                'targetGroupId' => $ftg->getTargetGroup()->getId(),
            ])->toArray(),
        ];
    }
}
