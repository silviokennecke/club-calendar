<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Command\SchedulerRunCommand;
use App\Scheduler\RunScheduledTaskHandler;
use App\Scheduler\ScheduledTask;
use App\Service\UnverifiedUserPruner;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Lock\LockFactory;

class SchedulerRunCommandTest extends KernelTestCase
{
    private function tester(?SchedulerRunCommand $command = null): CommandTester
    {
        $kernel = self::bootKernel();
        DatabaseResetter::reset(self::getContainer()->get(EntityManagerInterface::class));
        if (null !== $command) {
            return new CommandTester($command);
        }

        return new CommandTester((new Application($kernel))->find('app:scheduler:run'));
    }

    private function handlerWith(UnverifiedUserPruner $pruner): RunScheduledTaskHandler
    {
        $c = self::getContainer();

        return new RunScheduledTaskHandler(
            $pruner,
            $c->get(\App\Service\PasswordResetService::class),
            $c->get(\App\Service\AccountService::class),
            $c->get(\App\Repository\RefreshTokenRepository::class),
            $c->get(\App\Service\ClubInvitationService::class),
            $c->get(\App\Service\OAuthPruner::class),
            $c->get(\App\Repository\SecurityEventRepository::class),
            $c->get(\App\Security\NonceStore::class),
            $c->get(\App\Service\FailedMessagePruner::class),
            $c->get(\App\Service\HolidayRefreshService::class),
            $c->get(\App\Service\GeoIpUpdater::class),
            $c->get(\App\Sitemap\SitemapGenerator::class),
            $c->get(\App\Telemetry\InstanceMetricsReporter::class),
            $c->get(\Psr\Clock\ClockInterface::class),
            $c->get(\Psr\Log\LoggerInterface::class),
        );
    }

    private function command(RunScheduledTaskHandler $handler): SchedulerRunCommand
    {
        $c = self::getContainer();

        return new SchedulerRunCommand($handler, $c->get('app.scheduler_lock_factory'), $c->get(\App\Telemetry\Telemetry::class));
    }

    private function flat(CommandTester $t): string
    {
        return (string) preg_replace('/\s+/', ' ', $t->getDisplay());
    }

    public function testListShowsEveryTask(): void
    {
        $t = $this->tester();
        $this->assertSame(0, $t->execute(['--list' => true]));
        foreach (ScheduledTask::cases() as $task) {
            $this->assertStringContainsString($task->value, $t->getDisplay());
            $this->assertStringContainsString($task->cron(), $t->getDisplay());
        }
    }

    public function testUnknownNameFailsWithSuggestion(): void
    {
        $t = $this->tester();
        $this->assertSame(1, $t->execute(['task' => 'prune-security-event']));
        $this->assertStringContainsString('Did you mean "prune-security-events"', $this->flat($t));
        $this->assertStringContainsString('prune-oauth', $t->getDisplay());
    }

    public function testNonInteractiveWithoutArgumentFailsAndListsNames(): void
    {
        $t = $this->tester();
        $this->assertSame(1, $t->execute([], ['interactive' => false]));
        $this->assertStringContainsString('prune-security-events', $t->getDisplay());
    }

    public function testInteractiveChoiceRunsTheTask(): void
    {
        $t = $this->tester();
        $t->setInputs(['prune-auth-nonces']);
        $this->assertSame(0, $t->execute([], ['interactive' => true]));
        $this->assertStringContainsString('Task "prune-auth-nonces" finished', $t->getDisplay());
    }

    public function testRunsCheapTaskSuccessfully(): void
    {
        $t = $this->tester();
        $this->assertSame(0, $t->execute(['task' => 'prune-security-events']));
        $this->assertStringContainsString('Task "prune-security-events" finished', $t->getDisplay());
        $this->assertStringNotContainsString('logs failures', $t->getDisplay());
    }

    public function testSwallowingTaskPrintsNote(): void
    {
        $t = $this->tester();
        $this->assertSame(0, $t->execute(['task' => 'telemetry-hourly']));
        $this->assertStringContainsString('no OTLP endpoint', $t->getDisplay());
    }

    public function testExceptionGivesNonZeroAndReleasesLock(): void
    {
        $pruner = $this->createStub(UnverifiedUserPruner::class);
        $pruner->method('prune')->willThrowException(new \RuntimeException('boom'));
        $t = $this->tester($this->command($this->handlerWith($pruner)));

        $this->assertSame(1, $t->execute(['task' => 'prune-unverified-users']));
        $this->assertStringContainsString('RuntimeException: boom', $this->flat($t));

        $lock = self::getContainer()->get('app.scheduler_lock_factory')->createLock('manual-task-prune-unverified-users');
        $this->assertTrue($lock->acquire());
        $lock->release();
    }

    public function testLockTakenFailsWithoutRunningTheTask(): void
    {
        $pruner = $this->createMock(UnverifiedUserPruner::class);
        $pruner->expects($this->never())->method('prune');
        $t = $this->tester($this->command($this->handlerWith($pruner)));

        /** @var LockFactory $factory */
        $factory = self::getContainer()->get('app.scheduler_lock_factory');
        $held = $factory->createLock('manual-task-prune-unverified-users');
        $this->assertTrue($held->acquire());
        try {
            $this->assertSame(1, $t->execute(['task' => 'prune-unverified-users']));
            $this->assertStringContainsString('already being run manually', $t->getDisplay());
        } finally {
            $held->release();
        }
    }

    public function testDoesNotDependOnSchedulerEnabled(): void
    {
        $this->assertFalse((new \ReflectionClass(SchedulerRunCommand::class))->hasProperty('enabled'));
        $t = $this->tester();
        $this->assertSame(0, $t->execute(['task' => 'prune-auth-nonces']));
    }

    public function testCompletionSuggestsTaskNames(): void
    {
        $kernel = self::bootKernel();
        $tester = new \Symfony\Component\Console\Tester\CommandCompletionTester((new Application($kernel))->find('app:scheduler:run'));
        $this->assertContains('holidays-refresh', $tester->complete(['']));
    }
}
