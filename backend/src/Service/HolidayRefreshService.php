<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\HolidayCalendar;
use App\Enum\HolidaySource;
use Doctrine\ORM\EntityManagerInterface;

/** Re-fetches predefined (OpenHolidays) holiday calendars; one failing calendar does not stop the others. */
class HolidayRefreshService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly HolidayCalendarService $service,
    ) {
    }

    /** @return list<HolidayRefreshResult> */
    public function refresh(?string $calendarId = null): array
    {
        $criteria = ['source' => HolidaySource::OPENHOLIDAYS];
        if (null !== $calendarId) {
            $criteria['id'] = $calendarId;
        }
        $results = [];
        foreach ($this->em->getRepository(HolidayCalendar::class)->findBy($criteria) as $hc) {
            try {
                $results[] = new HolidayRefreshResult($hc->getName(), $this->service->fetchAndStore($hc));
            } catch (\Throwable $e) {
                $results[] = new HolidayRefreshResult($hc->getName(), null, $e);
            }
        }

        return $results;
    }
}
