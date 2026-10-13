<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\CalendarMemberVoter;
use App\Service\EventSeriesService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/** Event series of a calendar (created via `POST …/events/series`, see EventController). */
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
}
