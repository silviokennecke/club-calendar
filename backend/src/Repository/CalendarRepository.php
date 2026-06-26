<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\Calendar;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<Calendar>
 */
class CalendarRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Calendar::class);
    }

    public function findByIdAndClubId(int $id, int $clubId): ?Calendar
    {
        return $this->findOneBy(['id' => $id, 'club' => $clubId]);
    }
}
