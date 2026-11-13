<?php

declare(strict_types=1);

namespace App\Tests\Scheduler;

use App\Entity\PasswordReset;
use App\Scheduler\RunScheduledTask;
use App\Scheduler\RunScheduledTaskHandler;
use App\Scheduler\ScheduledTask;
use App\Service\GeoIpUpdater;
use App\Service\HolidayRefreshResult;
use App\Service\HolidayRefreshService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\AbstractLogger;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class RunScheduledTaskHandlerTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Connection $db;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->db = $this->em->getConnection();
        $this->db->executeStatement('DELETE FROM messenger_messages');
    }

    private function runTask(ScheduledTask $task): void
    {
        self::getContainer()->get(RunScheduledTaskHandler::class)(new RunScheduledTask($task));
    }

    private function rows(string $table): int
    {
        return (int) $this->db->fetchOne("SELECT COUNT(*) FROM $table");
    }

    public function testEveryTaskRunsAgainstTheDatabase(): void
    {
        foreach (ScheduledTask::cases() as $task) {
            if (ScheduledTask::HolidaysRefresh === $task || ScheduledTask::GeoIpUpdate === $task) {
                continue;
            }
            $this->runTask($task);
        }
        $this->addToAssertionCount(1);
    }

    public function testPrunesUnverifiedUsers(): void
    {
        $hasher = self::getContainer()->get(UserPasswordHasherInterface::class);
        $old = TestHelper::createUser($this->em, $hasher, null, 'password123', false);
        $fresh = TestHelper::createUser($this->em, $hasher, null, 'password123', false);
        $this->db->executeStatement('UPDATE user SET created_at = ? WHERE id = ?', [(new \DateTimeImmutable('-31 days'))->format('Y-m-d H:i:s'), $old->getId()]);
        $freshId = $fresh->getId();
        $this->em->clear();

        $this->runTask(ScheduledTask::PruneUnverifiedUsers);

        $this->assertSame([$freshId], $this->db->fetchFirstColumn('SELECT id FROM user'));
    }

    public function testPrunesExpiredPasswordResets(): void
    {
        $user = TestHelper::createUser($this->em, self::getContainer()->get(UserPasswordHasherInterface::class));
        $this->em->persist(new PasswordReset($user, str_repeat('a', 64), new \DateTimeImmutable('-3 hours')));
        $this->em->persist(new PasswordReset($user, str_repeat('b', 64), new \DateTimeImmutable()));
        $this->em->flush();

        $this->runTask(ScheduledTask::PrunePasswordResets);

        $this->assertSame(1, $this->rows('password_reset'));
    }

    public function testPrunesExpiredAuthNonces(): void
    {
        $insert = 'INSERT INTO auth_nonce (id, nonce_hash, expires_at) VALUES (?, ?, ?)';
        $this->db->executeStatement($insert, ['1', str_repeat('a', 64), (new \DateTimeImmutable('-1 hour', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s')]);
        $this->db->executeStatement($insert, ['2', str_repeat('b', 64), (new \DateTimeImmutable('+1 hour', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s')]);

        $this->runTask(ScheduledTask::PruneAuthNonces);

        $this->assertSame(1, $this->rows('auth_nonce'));
    }

    public function testPrunesOldFailedMessagesOnly(): void
    {
        $insert = 'INSERT INTO messenger_messages (body, headers, queue_name, created_at, available_at) VALUES (?, ?, ?, ?, ?)';
        $utc = new \DateTimeZone('UTC');
        $old = (new \DateTimeImmutable('-31 days', $utc))->format('Y-m-d H:i:s');
        $recent = (new \DateTimeImmutable('-29 days', $utc))->format('Y-m-d H:i:s');
        $this->db->executeStatement($insert, ['{}', '{}', 'failed', $old, $old]);
        $this->db->executeStatement($insert, ['{}', '{}', 'failed', $recent, $recent]);
        $this->db->executeStatement($insert, ['{}', '{}', 'default', $old, $old]);

        $this->runTask(ScheduledTask::PruneFailedMessages);

        $this->assertSame(['default' => 1, 'failed' => 1], array_map('intval', $this->db->fetchAllKeyValue('SELECT queue_name, COUNT(*) FROM messenger_messages GROUP BY queue_name')));
    }

    public function testHolidayAndGeoIpFailuresAreSwallowedAndLogged(): void
    {
        $logger = new class extends AbstractLogger {
            /** @var list<array{string, array<mixed>}> */
            public array $records = [];

            public function log($level, \Stringable|string $message, array $context = []): void
            {
                $this->records[] = [(string) $level, $context];
            }
        };
        $holidays = $this->createStub(HolidayRefreshService::class);
        $holidays->method('refresh')->willThrowException(new \RuntimeException('https://secret.example/?key=abc'));
        $geoIp = $this->createStub(GeoIpUpdater::class);
        $geoIp->method('update')->willThrowException(new \LogicException('secret'));

        $c = self::getContainer();
        $handler = new RunScheduledTaskHandler(
            $c->get(\App\Service\UnverifiedUserPruner::class),
            $c->get(\App\Service\PasswordResetService::class),
            $c->get(\App\Service\AccountService::class),
            $c->get(\App\Repository\RefreshTokenRepository::class),
            $c->get(\App\Service\ClubInvitationService::class),
            $c->get(\App\Service\OAuthPruner::class),
            $c->get(\App\Repository\SecurityEventRepository::class),
            $c->get(\App\Security\NonceStore::class),
            $c->get(\App\Service\FailedMessagePruner::class),
            $holidays,
            $geoIp,
            $c->get(\Psr\Clock\ClockInterface::class),
            $logger,
        );

        $handler(new RunScheduledTask(ScheduledTask::HolidaysRefresh));
        $handler(new RunScheduledTask(ScheduledTask::GeoIpUpdate));

        $this->assertSame([['warning', ['exception' => \RuntimeException::class]], ['warning', ['exception' => \LogicException::class]]], $logger->records);
    }

    public function testPerCalendarHolidayFailureIsLoggedWithoutMessage(): void
    {
        $logger = new class extends AbstractLogger {
            public array $records = [];

            public function log($level, \Stringable|string $message, array $context = []): void
            {
                $this->records[] = $context;
            }
        };
        $holidays = $this->createStub(HolidayRefreshService::class);
        $holidays->method('refresh')->willReturn([
            new HolidayRefreshResult('A', 3),
            new HolidayRefreshResult('B', null, new \RuntimeException('https://x/?token=1')),
        ]);
        $c = self::getContainer();
        $handler = new RunScheduledTaskHandler(
            $c->get(\App\Service\UnverifiedUserPruner::class),
            $c->get(\App\Service\PasswordResetService::class),
            $c->get(\App\Service\AccountService::class),
            $c->get(\App\Repository\RefreshTokenRepository::class),
            $c->get(\App\Service\ClubInvitationService::class),
            $c->get(\App\Service\OAuthPruner::class),
            $c->get(\App\Repository\SecurityEventRepository::class),
            $c->get(\App\Security\NonceStore::class),
            $c->get(\App\Service\FailedMessagePruner::class),
            $holidays,
            $c->get(GeoIpUpdater::class),
            $c->get(\Psr\Clock\ClockInterface::class),
            $logger,
        );

        $handler(new RunScheduledTask(ScheduledTask::HolidaysRefresh));

        $this->assertSame([['exception' => \RuntimeException::class]], $logger->records);
    }

    public function testGeoIpWithoutLicenseKeyIsANoOp(): void
    {
        $this->runTask(ScheduledTask::GeoIpUpdate);
        $this->addToAssertionCount(1);
    }
}
