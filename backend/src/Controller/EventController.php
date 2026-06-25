<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/calendars/{calendarId}/events')]
class EventController extends AbstractApiController
{
    public function __construct(
        private readonly EventService $eventService,
        private readonly EntityManagerInterface $em,
    ) {}

    #[Route('', methods: ['GET'])]
    public function list(int $calendarId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: true);
        $from = $request->query->get('from');
        $to = $request->query->get('to');
        if ($from && false === strtotime($from)) {
            throw new BadRequestHttpException('Invalid from date');
        }
        if ($to && false === strtotime($to)) {
            throw new BadRequestHttpException('Invalid to date');
        }
        $tgParam = $request->query->get('targetGroupIds');
        $tgIds = $tgParam ? array_filter(array_map('intval', explode(',', $tgParam))) : null;

        return new JsonResponse($this->eventService->listEvents($calendar, $from ?: null, $to ?: null, $tgIds ?: null));
    }

    #[Route('/from-template', methods: ['POST'])]
    public function createFromTemplate(int $calendarId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);
        if (empty($data['templateId']) || empty($data['dates'])) {
            throw new BadRequestHttpException('templateId and dates are required');
        }

        $events = $this->eventService->createSeriesFromTemplate(
            $calendar,
            (int) $data['templateId'],
            (array) $data['dates'],
            (array) ($data['overrides'] ?? []),
        );

        return new JsonResponse($events, Response::HTTP_CREATED);
    }

    #[Route('/import', methods: ['POST'])]
    public function import(int $calendarId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
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
    public function create(int $calendarId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);

        return new JsonResponse($this->eventService->createEvent($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{id}', methods: ['GET'])]
    public function getOne(int $calendarId, int $id): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: true);

        return new JsonResponse($this->eventService->getEvent($id, $calendar));
    }

    #[Route('/{id}', methods: ['PATCH'])]
    public function update(int $calendarId, int $id, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);

        return new JsonResponse($this->eventService->updateEvent($id, $calendar, $data));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    public function delete(int $calendarId, int $id): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $this->eventService->deleteEvent($id, $calendar);

        return new JsonResponse(['ok' => true]);
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
