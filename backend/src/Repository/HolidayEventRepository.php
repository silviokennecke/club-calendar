<?php
declare(strict_types=1);

namespace App\Repository;

use App\Entity\HolidayEvent;
use DateTimeImmutable;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

class HolidayEventRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, HolidayEvent::class);
    }

    /** @return HolidayEvent[] */
    public function findByCalendarAndDateRange(int $calendarId, DateTimeImmutable $from, DateTimeImmutable $to): array
    {
        return $this->createQueryBuilder('he')
            ->join('he.holidayCalendar', 'hc')
            ->where('hc.calendar = :calendarId')
            ->andWhere('he.date <= :to')
            ->andWhere('COALESCE(he.dateEnd, he.date) >= :from')
            ->setParameter('calendarId', $calendarId)
            ->setParameter('from', $from)
            ->setParameter('to', $to)
            ->orderBy('he.date', 'ASC')
            ->getQuery()
            ->getResult();
    }
}
