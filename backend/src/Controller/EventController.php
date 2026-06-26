<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/events')]
class EventController extends AbstractApiController
{
    public function __construct(
        private readonly EventService $eventService,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $from = $request->query->get('from');
        $to = $request->query->get('to');
        if ($from && false === strtotime($from)) {
            throw new BadRequestHttpException('Invalid from date');
        }
        if ($to && false === strtotime($to)) {
            throw new BadRequestHttpException('Invalid to date');
        }
        $tgParam = $request->query->get('targetGroupIds');
        $tgIds = $tgParam ? array_values(array_filter(array_map('trim', explode(',', $tgParam)))) : null;

        return new JsonResponse($this->eventService->listEvents($calendar, $from ?: null, $to ?: null, $tgIds ?: null));
    }

    #[Route('/from-template', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function createFromTemplate(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        if (empty($data['templateId']) || empty($data['dates'])) {
            throw new BadRequestHttpException('templateId and dates are required');
        }

        $events = $this->eventService->createSeriesFromTemplate(
            $calendar,
            (string) $data['templateId'],
            (array) $data['dates'],
            (array) ($data['overrides'] ?? []),
        );

        return new JsonResponse($events, Response::HTTP_CREATED);
    }

    #[Route('/import', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function import(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        if (empty($data['events']) || !is_array($data['events'])) {
            throw new BadRequestHttpException('events array required');
        }
        if (count($data['events']) > 500) {
            throw new BadRequestHttpException('Maximum 500 events per import');
        }

        $imported = $this->eventService->importEvents($calendar, $data['events']);

        return new JsonResponse(['imported' => $imported], Response::HTTP_CREATED);
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function create(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->eventService->createEvent($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{id}', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function getOne(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $id): JsonResponse
    {
        return new JsonResponse($this->eventService->getEvent($id, $calendar));
    }

    #[Route('/{id}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $id, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->eventService->updateEvent($id, $calendar, $data));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function delete(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $id): JsonResponse
    {
        $this->eventService->deleteEvent($id, $calendar);

        return new JsonResponse(['ok' => true]);
    }
}
