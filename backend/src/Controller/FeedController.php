<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\FeedService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/feeds')]
class FeedController extends AbstractApiController
{
    public function __construct(
        private readonly FeedService $feedService,
    ) {
    }

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar): JsonResponse
    {
        return new JsonResponse($this->feedService->list($calendar));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function create(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->feedService->create($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{feedId}', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function getOne(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $feedId): JsonResponse
    {
        return new JsonResponse($this->feedService->get($feedId, $calendar));
    }

    #[Route('/{feedId}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $feedId, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->feedService->update($feedId, $calendar, $data));
    }

    #[Route('/{feedId}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function delete(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $feedId): JsonResponse
    {
        $this->feedService->delete($feedId, $calendar);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{feedId}/regenerate-secret', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function regenerateSecret(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $feedId): JsonResponse
    {
        return new JsonResponse($this->feedService->regenerateSecret($feedId, $calendar));
    }
}
