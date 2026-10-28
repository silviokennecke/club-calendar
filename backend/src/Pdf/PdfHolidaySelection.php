<?php

declare(strict_types=1);

namespace App\Pdf;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Exception\ApiProblemException;
use App\Service\CalendarReferences;
use App\Service\ExportFilter;
use App\Service\HolidayCalendarService;
use App\Service\Input;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\EntityManagerInterface;

/** Resolves the `holidayCalendarIds[]` of a PDF request and loads their holidays inside the exported period. */
readonly class PdfHolidaySelection
{
    public const int MAX_CALENDARS = 20;

    public function __construct(
        private EntityManagerInterface $em,
        private HolidayCalendarService $holidays,
    ) {
    }

    /**
     * @return list<array{type: string, name: string, date: string, dateEnd: string}> dateEnd is inclusive
     */
    public function load(Calendar $calendar, mixed $value, ExportFilter $filter): array
    {
        $calendars = $this->resolve($calendar, $value);
        if ([] === $calendars || null === $filter->fromDate || null === $filter->toDate) {
            return [];
        }
        foreach ($calendars as $hc) {
            $this->holidays->refreshIfStale($hc);
        }

        $events = $this->em->createQueryBuilder()
            ->select('he')
            ->from(HolidayEvent::class, 'he')
            ->where('he.holidayCalendar IN (:ids)')
            ->andWhere('he.date <= :to')
            ->andWhere('COALESCE(he.dateEnd, he.date) >= :from')
            ->setParameter('ids', $calendars)
            ->setParameter('from', $filter->fromDate, Types::DATE_IMMUTABLE)
            ->setParameter('to', $filter->toDate, Types::DATE_IMMUTABLE)
            ->orderBy('he.date')
            ->addOrderBy('he.id')
            ->getQuery()
            ->getResult();

        $rows = [];
        foreach ($events as $event) {
            /* @var HolidayEvent $event */
            $rows[] = [
                'type' => $event->getHolidayCalendar()->getType()->value,
                'name' => $event->getName(),
                'date' => $event->getDate()->format('Y-m-d'),
                'dateEnd' => ($event->getDateEnd() ?? $event->getDate())->format('Y-m-d'),
            ];
        }

        return $rows;
    }

    /**
     * @return list<HolidayCalendar>
     */
    private function resolve(Calendar $calendar, mixed $value): array
    {
        if (null === $value || '' === $value) {
            return [];
        }
        if (is_string($value)) {
            $value = array_values(array_filter(array_map('trim', explode(',', $value)), static fn (string $id): bool => '' !== $id));
        }
        if (!is_array($value)) {
            throw Input::invalid('holidayCalendarIds', 'holidayCalendarIds must be a list of ids');
        }
        $ids = Input::idList(['holidayCalendarIds' => array_values($value)], 'holidayCalendarIds');
        if (count($ids) > self::MAX_CALENDARS) {
            throw Input::invalid('holidayCalendarIds', sprintf('At most %d holiday calendars', self::MAX_CALENDARS));
        }

        $found = [];
        foreach ($ids as $id) {
            $hc = $this->em->getRepository(HolidayCalendar::class)->find($id);
            if (!$hc instanceof HolidayCalendar || $hc->getCalendar()->getId() !== $calendar->getId()) {
                throw new ApiProblemException(422, sprintf('holidayCalendarIds: unknown id "%s" in this calendar', $id), CalendarReferences::CODE, 'holidayCalendarIds');
            }
            $found[$hc->getId()] = $hc;
        }

        return array_values($found);
    }
}
