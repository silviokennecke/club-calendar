<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventExportService;
use App\Service\EventImportService;
use App\Service\EventSeriesService;
use App\Service\EventService;
use App\Service\Input;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/events')]
class EventController extends AbstractApiController
{
    public function __construct(
        private readonly EventService $eventService,
        private readonly EventImportService $importService,
        private readonly EventExportService $exportService,
        private readonly EventSeriesService $seriesService,
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

    /**
     * Events of the calendar, sorted. `from`/`to` (YYYY-MM-DD, overlap, at most EventService::LIST_MAX_RANGE_DAYS
     * apart), `targetGroupIds` (comma-separated), `limit` (1..LIST_MAX_LIMIT, default LIST_MAX_LIMIT) and `offset`.
     * Body: plain list; `X-Total-Count`: number of all matches.
     */
    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        // Strictly YYYY-MM-DD (400 validation_failed with the field), like the export and the public feed
        $query = $request->query->all();
        $from = Input::optionalDate($query['from'] ?? null, 'from');
        $to = Input::optionalDate($query['to'] ?? null, 'to');
        Input::assertDateRange($from, $to);
        Input::assertMaxRange($from, $to, EventService::LIST_MAX_RANGE_DAYS);
        $tgParam = $request->query->get('targetGroupIds');
        $tgIds = $tgParam ? Input::idList(['targetGroupIds' => array_values(array_filter(array_map('trim', explode(',', (string) $tgParam))))], 'targetGroupIds') : null;
        $limit = Input::optionalInt($query['limit'] ?? null, 'limit', 1, EventService::LIST_MAX_LIMIT) ?? EventService::LIST_MAX_LIMIT;
        $offset = Input::optionalInt($query['offset'] ?? null, 'offset', 0, PHP_INT_MAX) ?? 0;

        $page = $this->eventService->listEvents($calendar, $from, $to, $tgIds ?: null, $limit, $offset);

        // The body stays a plain list; the total of all matches (before limit/offset) is in a header
        return new JsonResponse($page['items'], 200, ['X-Total-Count' => (string) $page['total']]);
    }

    #[Route('/from-template', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function createFromTemplate(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        if (empty($data['templateId'])) {
            throw Input::invalid('templateId', 'templateId is required');
        }
        if (empty($data['dates'])) {
            throw Input::invalid('dates', 'dates is required (list of YYYY-MM-DD)');
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
     * Dates of a series rule without writing anything: `{rule, event?: {durationDays}}` →
     * `{dates, count, skippedHolidays, holidays}` (same validation as creating the series).
     */
    #[Route('/series/preview', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function seriesPreview(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        return new JsonResponse($this->seriesService->preview($calendar, $this->decodeJson($request)));
    }

    /**
     * Creates a series and all its events atomically: `{rule, templateId?, event?, isDraft?}` → 201 `{series, events}`.
     * At most SeriesRule::MAX_EVENTS events (422 `too_many_events`).
     */
    #[Route('/series', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function createSeries(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        return new JsonResponse($this->seriesService->create($calendar, $this->decodeJson($request)), Response::HTTP_CREATED);
    }

    /**
     * Dry run of the import: status per entry (new / duplicate / invalid), nothing is written.
     * Same body and limits as the import; blocked in archived calendars like every write route.
     */
    #[Route('/import/preview', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
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
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
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
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function bulk(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        return new JsonResponse($this->eventService->bulk($calendar, $this->decodeJson($request)));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
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

    /** Body may carry `scope: "this" | "all"` (series events, default `this`, see EventService::updateEvent). */
    #[Route('/{id}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $id, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->eventService->updateEvent($id, $calendar, $data));
    }

    /** `?scope=this|all` (series events, default `this`, see EventService::deleteEvent). */
    #[Route('/{id}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function delete(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $id, Request $request): JsonResponse
    {
        $this->eventService->deleteEvent($id, $calendar, $request->query->all()['scope'] ?? null);

        return new JsonResponse(['ok' => true]);
    }
}
