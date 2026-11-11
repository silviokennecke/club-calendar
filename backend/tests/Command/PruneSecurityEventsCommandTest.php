<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\SecurityEvent;
use App\Enum\SecurityEventType;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class PruneSecurityEventsCommandTest extends WebTestCase
{
    public function testDeletesOnlyEventsOlderThanOneYear(): void
    {
        $client = static::createClient();
        $em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, static::getContainer()->get(UserPasswordHasherInterface::class));
        $utc = new \DateTimeZone('UTC');
        $old = new SecurityEvent($user, SecurityEventType::LOGIN, true, new \DateTimeImmutable('-366 days', $utc));
        $recent = new SecurityEvent($user, SecurityEventType::LOGIN, true, new \DateTimeImmutable('-364 days', $utc));
        $em->persist($old);
        $em->persist($recent);
        $em->flush();
        $recentId = $recent->getId();
        $em->clear();

        $t = new CommandTester((new Application($client->getKernel()))->find('app:prune-security-events'));
        $this->assertSame(0, $t->execute([]));
        $this->assertStringContainsString('Deleted 1 security event', $t->getDisplay());
        $rows = $em->getRepository(SecurityEvent::class)->findAll();
        $this->assertCount(1, $rows);
        $this->assertSame($recentId, $rows[0]->getId());
    }
}
