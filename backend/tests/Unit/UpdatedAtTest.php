<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Entity\Club;
use App\Entity\Location;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

class UpdatedAtTest extends KernelTestCase
{
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        $this->em->getConnection()->executeStatement('SET FOREIGN_KEY_CHECKS=0');
        $this->em->getConnection()->executeStatement('TRUNCATE location');
        $this->em->getConnection()->executeStatement('TRUNCATE calendar');
        $this->em->getConnection()->executeStatement('TRUNCATE club');
        $this->em->getConnection()->executeStatement('SET FOREIGN_KEY_CHECKS=1');
    }

    public function testUpdatedAtIsSetOnPersist(): void
    {
        $before = new \DateTimeImmutable();
        $location = $this->makeLocation();
        $this->em->persist($location);
        $this->em->flush();
        $after = new \DateTimeImmutable();

        $this->assertGreaterThanOrEqual($before->getTimestamp(), $location->getUpdatedAt()->getTimestamp());
        $this->assertLessThanOrEqual($after->getTimestamp(), $location->getUpdatedAt()->getTimestamp());
    }

    public function testUpdatedAtChangesOnUpdate(): void
    {
        $location = $this->makeLocation();
        $this->em->persist($location);
        $this->em->flush();

        $first = $location->getUpdatedAt()->getTimestamp();
        sleep(1);

        $location->setLatitude(48.0);
        $this->em->flush();

        $this->assertGreaterThan($first, $location->getUpdatedAt()->getTimestamp());
    }

    private function makeLocation(): Location
    {
        $this->em->getConnection()->executeStatement(
            "INSERT INTO club (id, name, timezone, updated_at) VALUES ('club-1', 'Test', 'UTC', NOW())",
        );
        $this->em->getConnection()->executeStatement(
            "INSERT INTO calendar (id, club_id, name, updated_at) VALUES ('cal-1', 'club-1', 'Test', NOW())",
        );
        $club = $this->em->find(Club::class, 'club-1');
        $location = new Location();
        $location->setClub($club);
        $location->setName('Test Location');

        return $location;
    }
}
