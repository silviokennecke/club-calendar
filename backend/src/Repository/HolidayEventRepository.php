<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\HolidayEvent;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\Persistence\ManagerRegistry;

class HolidayEventRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, HolidayEvent::class);
    }

    /** @return HolidayEvent[] */
    public function findByCalendarAndDateRange(string $calendarId, \DateTimeImmutable $from, \DateTimeImmutable $to): array
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

    /**
     * Holidays of all holiday calendars of a calendar; with from/to only those overlapping the range.
     *
     * @return HolidayEvent[]
     */
    public function findByCalendar(string $calendarId, ?\DateTimeImmutable $from, ?\DateTimeImmutable $to): array
    {
        $qb = $this->createQueryBuilder('he')
            ->join('he.holidayCalendar', 'hc')
            ->where('hc.calendar = :calendarId')
            ->setParameter('calendarId', $calendarId)
            ->orderBy('he.date', 'ASC');
        if (null !== $to) {
            $qb->andWhere('he.date <= :to')->setParameter('to', $to, Types::DATE_IMMUTABLE);
        }
        if (null !== $from) {
            $qb->andWhere('COALESCE(he.dateEnd, he.date) >= :from')->setParameter('from', $from, Types::DATE_IMMUTABLE);
        }

        return $qb->getQuery()->getResult();
    }
}
