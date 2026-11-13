<?php

declare(strict_types=1);

namespace App\Tests\Command;

use Doctrine\DBAL\Connection;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;

class PruneFailedMessagesCommandTest extends KernelTestCase
{
    public function testDeletesFailedMessagesOlderThan30Days(): void
    {
        $kernel = self::bootKernel();
        $db = self::getContainer()->get(Connection::class);
        $db->executeStatement('DELETE FROM messenger_messages');
        $utc = new \DateTimeZone('UTC');
        $old = (new \DateTimeImmutable('-31 days', $utc))->format('Y-m-d H:i:s');
        $new = (new \DateTimeImmutable('-1 day', $utc))->format('Y-m-d H:i:s');
        $insert = 'INSERT INTO messenger_messages (body, headers, queue_name, created_at, available_at) VALUES (?, ?, ?, ?, ?)';
        $db->executeStatement($insert, ['{}', '{}', 'failed', $old, $old]);
        $db->executeStatement($insert, ['{}', '{}', 'failed', $new, $new]);

        $t = new CommandTester((new Application($kernel))->find('app:prune-failed-messages'));
        $this->assertSame(0, $t->execute([]));
        $this->assertStringContainsString('Deleted 1 failed message', $t->getDisplay());
        $this->assertSame(1, (int) $db->fetchOne('SELECT COUNT(*) FROM messenger_messages'));
        $db->executeStatement('DELETE FROM messenger_messages');
    }
}
