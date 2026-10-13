<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventExportService;
use App\Service\EventImportService;
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
        private readonly EventImportService $importService,
        private readonly EventExportService $exportService,
    ) {
    }

    /**
     * ICS download of the calendar's events for members: `?from&to` (YYYY-MM-DD, overlap),
     * `includeDrafts` (drafts as STATUS:TENTATIVE), `targetGroupIds[]` (ids of this calendar).
     */
    #[Route('.ics', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function exportIcs(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): Response
    {
        $query = $request->query->all();
        $content = $this->exportService->export(
            $calendar,
            $query['from'] ?? null,
            $query['to'] ?? null,
            $query['includeDrafts'] ?? null,
            $query['targetGroupIds'] ?? null,
        );

        return new Response($content, 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => $this->exportService->contentDisposition($calendar),
            'Cache-Control' => 'no-cache, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

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

    /**
     * Dry run of the import: status per entry (new / duplicate / invalid), nothing is written.
     * Same body and limits as the import; blocked in archived calendars like every write route.
     */
    #[Route('/import/preview', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function importPreview(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        return new JsonResponse($this->importService->preview($calendar, $this->decodeJson($request)));
    }

    /**
     * Atomic import: `{events, locations?, skipDuplicates?}` → `{imported, skipped, createdLocations, ids, warnings}`.
     * At most EventImportService::MAX_EVENTS events per request (413 `too_many_events`).
     */
    #[Route('/import', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function import(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        return new JsonResponse($this->importService->import($calendar, $this->decodeJson($request)), Response::HTTP_CREATED);
    }

    /**
     * Bulk action on several events of this calendar, all or nothing:
     * `{ids: [...], action: "publish" | "draft" | "delete"}` → `{affected}`.
     * POST (not PATCH/DELETE on the collection): one route for an action that may also delete, with a
     * JSON body (DELETE bodies are not reliably supported by proxies and clients).
     */
    #[Route('/bulk', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function bulk(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        return new JsonResponse($this->eventService->bulk($calendar, $this->decodeJson($request)));
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
