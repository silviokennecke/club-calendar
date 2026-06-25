<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\FeedService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/calendars/{calendarId}/feeds')]
class FeedController extends AbstractApiController
{
    public function __construct(
        private readonly FeedService $feedService,
        private readonly EntityManagerInterface $em,
    ) {}

    #[Route('', methods: ['GET'])]
    public function list(int $calendarId): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: true);

        return new JsonResponse($this->feedService->list($calendar));
    }

    #[Route('', methods: ['POST'])]
    public function create(int $calendarId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);

        return new JsonResponse($this->feedService->create($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{feedId}', methods: ['PATCH'])]
    public function update(int $calendarId, int $feedId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);

        return new JsonResponse($this->feedService->update($feedId, $calendar, $data));
    }

    #[Route('/{feedId}', methods: ['DELETE'])]
    public function delete(int $calendarId, int $feedId): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $this->feedService->delete($feedId, $calendar);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{feedId}/regenerate-secret', methods: ['POST'])]
    public function regenerateSecret(int $calendarId, int $feedId): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);

        return new JsonResponse($this->feedService->regenerateSecret($feedId, $calendar));
    }

    private function findCalendar(int $calendarId, bool $readOnly): Calendar
    {
        $calendar = $this->em->getRepository(Calendar::class)->find($calendarId);
        if (!$calendar) {
            throw new NotFoundHttpException('Calendar not found');
        }
        $this->denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, $calendar);
        if (!$readOnly) {
            $this->denyAccessUnlessGranted(ArchivedCalendarVoter::NOT_ARCHIVED, $calendar);
        }

        return $calendar;
    }
}
