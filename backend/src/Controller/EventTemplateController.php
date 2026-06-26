<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventTemplateService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/templates')]
class EventTemplateController extends AbstractApiController
{
    public function __construct(
        private readonly EventTemplateService $templateService,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar): JsonResponse
    {
        return new JsonResponse($this->templateService->listTemplates($calendar));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function create(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->templateService->createTemplate($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{id}', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function getOne(#[MapEntity(id: 'calendarId')] Calendar $calendar, int $id): JsonResponse
    {
        return new JsonResponse($this->templateService->getTemplate($id, $calendar));
    }

    #[Route('/{id}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(#[MapEntity(id: 'calendarId')] Calendar $calendar, int $id, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->templateService->updateTemplate($id, $calendar, $data));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function delete(#[MapEntity(id: 'calendarId')] Calendar $calendar, int $id): JsonResponse
    {
        $this->templateService->deleteTemplate($id, $calendar);

        return new JsonResponse(['ok' => true]);
    }
}
