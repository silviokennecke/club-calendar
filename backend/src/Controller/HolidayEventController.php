<?php
declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Repository\HolidayEventRepository;
use App\Security\CalendarMemberVoter;
use DateTimeImmutable;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/calendars/{calendarId}/holiday-events')]
class HolidayEventController extends AbstractApiController
{
    public function __construct(
        private readonly HolidayEventRepository $holidayEventRepo,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
    ): JsonResponse {
        $from = $request->query->get('from');
        $to = $request->query->get('to');
        if (!$from || !$to) {
            throw new BadRequestHttpException('from and to query params are required');
        }

        $events = $this->holidayEventRepo->findByCalendarAndDateRange(
            $calendar->getId(),
            new DateTimeImmutable($from),
            new DateTimeImmutable($to),
        );

        return new JsonResponse(array_map(fn ($e) => [
            'id'                => $e->getId(),
            'holidayCalendarId' => $e->getHolidayCalendar()->getId(),
            'name'              => $e->getName(),
            'date'              => $e->getDate()->format('Y-m-d'),
            'dateEnd'           => $e->getDateEnd()?->format('Y-m-d'),
        ], $events));
    }
}
