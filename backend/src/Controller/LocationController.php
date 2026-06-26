<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\LocationService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/locations')]
class LocationController extends AbstractApiController
{
    public function __construct(
        private readonly LocationService $locationService,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar): JsonResponse
    {
        return new JsonResponse($this->locationService->list($calendar));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function create(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->locationService->create($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{id}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(#[MapEntity(id: 'calendarId')] Calendar $calendar, int $id, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->locationService->update($id, $calendar, $data));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function delete(#[MapEntity(id: 'calendarId')] Calendar $calendar, int $id): JsonResponse
    {
        $this->locationService->delete($id, $calendar);

        return new JsonResponse(['ok' => true]);
    }
}
