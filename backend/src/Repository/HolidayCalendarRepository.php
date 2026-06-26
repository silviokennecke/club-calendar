<?php
declare(strict_types=1);

namespace App\Repository;

use App\Entity\HolidayCalendar;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

class HolidayCalendarRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, HolidayCalendar::class);
    }

    /** @return HolidayCalendar[] */
    public function findByCalendarId(int $calendarId): array
    {
        return $this->createQueryBuilder('hc')
            ->where('hc.calendar = :calendarId')
            ->setParameter('calendarId', $calendarId)
            ->orderBy('hc.name', 'ASC')
            ->getQuery()
            ->getResult();
    }
}
