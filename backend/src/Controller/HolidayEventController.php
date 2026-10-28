<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Repository\HolidayCalendarRepository;
use App\Repository\HolidayEventRepository;
use App\Security\CalendarMemberVoter;
use App\Service\HolidayCalendarService;
use App\Service\Input;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/holiday-events')]
class HolidayEventController extends AbstractApiController
{
    public function __construct(
        private readonly HolidayEventRepository $holidayEventRepo,
        private readonly HolidayCalendarRepository $holidayCalendarRepo,
        private readonly HolidayCalendarService $holidayCalendarService,
    ) {
    }

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
    ): JsonResponse {
        // Both required, strictly YYYY-MM-DD (400 validation_failed with the field)
        $query = $request->query->all();
        $fromDate = Input::date($query, 'from');
        $toDate = Input::date($query, 'to');
        Input::assertDateRange($fromDate, $toDate);

        foreach ($this->holidayCalendarRepo->findByCalendarId($calendar->getId()) as $hc) {
            $this->holidayCalendarService->refreshIfStale($hc);
        }

        $events = $this->holidayEventRepo->findByCalendarAndDateRange(
            $calendar->getId(),
            $fromDate,
            $toDate,
        );

        return new JsonResponse(array_map(fn ($e) => [
            'id' => $e->getId(),
            'holidayCalendarId' => $e->getHolidayCalendar()->getId(),
            'name' => $e->getName(),
            'date' => $e->getDate()->format('Y-m-d'),
            'dateEnd' => $e->getDateEnd()?->format('Y-m-d'),
        ], $events));
    }
}
