<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\CalendarFeed;
use App\Entity\Event;
use App\Enum\FeedVisibility;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class PublicFeedService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly IcsService $icsService,
    ) {}

    public function getFeedEvents(string $feedId, ?string $secret, ?array $targetGroupIds): array
    {
        $feed   = $this->loadFeed($feedId, $secret);
        $events = $this->loadEvents($feed, $targetGroupIds);

        return [
            'feed'   => ['id' => $feed->getId(), 'name' => $feed->getName()],
            'events' => array_map(fn ($e) => $this->serializeEvent($e), $events),
        ];
    }

    public function getFeedIcs(string $feedId, ?string $secret, ?array $targetGroupIds): string
    {
        $feed   = $this->loadFeed($feedId, $secret);
        $events = $this->loadEvents($feed, $targetGroupIds);
        $club   = $feed->getCalendar()->getClub();

        return $this->icsService->buildIcs($feed, $club, $events);
    }

    private function loadFeed(string $feedId, ?string $secret): CalendarFeed
    {
        $feed = $this->em->getRepository(CalendarFeed::class)->find($feedId);
        if (!$feed) {
            throw new NotFoundHttpException('Feed not found');
        }

        // Archived calendar → 404
        if ($feed->getCalendar()->getArchivedAt() !== null) {
            throw new NotFoundHttpException('Feed not found');
        }

        // Private feed: check secret
        if ($feed->getVisibility() === FeedVisibility::PRIVATE) {
            if (!$secret || !hash_equals($feed->getSharedSecret(), $secret)) {
                throw new AccessDeniedHttpException('Invalid or missing secret');
            }
        }

        return $feed;
    }

    private function loadEvents(CalendarFeed $feed, ?array $targetGroupIds): array
    {
        $feedTargetGroupIds = $feed->getTargetGroups()
            ->map(fn ($ftg) => $ftg->getTargetGroup()->getId())
            ->toArray();

        $qb = $this->em->createQueryBuilder()
            ->select('e')
            ->from(Event::class, 'e')
            ->where('e.calendar = :calendar')
            ->andWhere('e.isDraft = false')
            ->setParameter('calendar', $feed->getCalendar())
            ->orderBy('e.date', 'ASC')
            ->addOrderBy('e.timeBegin', 'ASC');

        // Apply target group filter: use query param TGs, or fall back to feed's own TGs if configured
        $effectiveTgIds = $targetGroupIds ?? (count($feedTargetGroupIds) > 0 ? $feedTargetGroupIds : null);
        if ($effectiveTgIds) {
            $qb->andWhere('EXISTS (SELECT etg FROM App\Entity\EventTargetGroup etg WHERE etg.event = e AND etg.targetGroup IN (:tgIds))')
               ->setParameter('tgIds', $effectiveTgIds);
        }

        return $qb->getQuery()->getResult();
    }

    private function serializeEvent(Event $e): array
    {
        return [
            'id'           => $e->getId(),
            'calendarId'   => $e->getCalendar()->getId(),
            'name'         => $e->getName(),
            'date'         => $e->getDate()->format('Y-m-d'),
            'dateEnd'      => $e->getDateEnd()?->format('Y-m-d'),
            'timeBegin'    => $e->getTimeBegin(),
            'timeEnd'      => $e->getTimeEnd(),
            'isAllDay'     => $e->isAllDay(),
            'timezone'     => $e->getTimezone(),
            'location'     => $e->getLocation() ? [
                'id'        => $e->getLocation()->getId(),
                'name'      => $e->getLocation()->getName(),
                'street'    => $e->getLocation()->getStreet(),
                'zip'       => $e->getLocation()->getZip(),
                'city'      => $e->getLocation()->getCity(),
                'country'   => $e->getLocation()->getCountry(),
                'latitude'  => $e->getLocation()->getLatitude(),
                'longitude' => $e->getLocation()->getLongitude(),
            ] : null,
            'properties'   => $e->getProperties()->map(fn ($ep) => [
                'propertyId' => $ep->getProperty()->getId(),
                'property'   => [
                    'id'   => $ep->getProperty()->getId(),
                    'name' => $ep->getProperty()->getName(),
                    'icon' => $ep->getProperty()->getIcon(),
                ],
            ])->toArray(),
            'features'     => $e->getFeatures()->map(fn ($ef) => [
                'featureId' => $ef->getFeature()->getId(),
                'feature'   => [
                    'id'   => $ef->getFeature()->getId(),
                    'name' => $ef->getFeature()->getName(),
                ],
            ])->toArray(),
            'targetGroups' => $e->getTargetGroups()->map(fn ($etg) => [
                'targetGroupId' => $etg->getTargetGroup()->getId(),
                'targetGroup'   => [
                    'id'   => $etg->getTargetGroup()->getId(),
                    'name' => $etg->getTargetGroup()->getName(),
                ],
            ])->toArray(),
        ];
    }
}
