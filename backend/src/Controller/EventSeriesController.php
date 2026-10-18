<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventSeriesService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/** Event series of a calendar (created via `POST …/events/series`, see EventController): read, change the rule. */
#[Route('/api/calendars/{calendarId}/event-series')]
class EventSeriesController extends AbstractApiController
{
    public function __construct(private readonly EventSeriesService $seriesService)
    {
    }

    /** Rule, template and `eventCount` of a series (also readable in archived calendars). */
    #[Route('/{seriesId}', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function get(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $seriesId): JsonResponse
    {
        return new JsonResponse($this->seriesService->get($calendar, $seriesId));
    }

    /**
     * What changing the rule would do now, without writing anything: `{rule}` → `{toCreate: [{date}],
     * toDelete: [{id, date, name, isDraft}], kept, past, skippedHolidays}` (only future events change).
     */
    #[Route('/{seriesId}/preview-update', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function previewUpdate(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $seriesId, Request $request): JsonResponse
    {
        return new JsonResponse($this->seriesService->previewUpdate($calendar, $seriesId, $this->decodeJson($request)));
    }

    /**
     * Changes the rule and applies it to the future events atomically: `{rule}` → `{series, created, deleted,
     * kept}` (see EventSeriesService::update).
     */
    #[Route('/{seriesId}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $seriesId, Request $request): JsonResponse
    {
        return new JsonResponse($this->seriesService->update($calendar, $seriesId, $this->decodeJson($request)));
    }
}
