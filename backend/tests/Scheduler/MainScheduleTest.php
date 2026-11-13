<?php

declare(strict_types=1);

namespace App\Tests\Scheduler;

use App\Scheduler\MainSchedule;
use App\Scheduler\RunScheduledTask;
use App\Scheduler\ScheduledTask;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Lock\Store\InMemoryStore;
use Symfony\Component\Messenger\Message\RedispatchMessage;
use Symfony\Component\Scheduler\Generator\MessageContext;
use Symfony\Component\Scheduler\Schedule;
use Symfony\Component\Scheduler\Trigger\CronExpressionTrigger;
use Symfony\Component\Scheduler\Trigger\TriggerInterface;
use Symfony\Contracts\Cache\CacheInterface;

class MainScheduleTest extends KernelTestCase
{
    /** @return list<array{ScheduledTask, string, string}> task, cron, async transport */
    private function entries(Schedule $schedule): array
    {
        $entries = [];
        foreach ($schedule->getRecurringMessages() as $recurring) {
            $trigger = $recurring->getTrigger();
            $this->assertInstanceOf(TriggerInterface::class, $trigger);
            $this->assertInstanceOf(CronExpressionTrigger::class, $trigger);
            foreach ($recurring->getMessages(new MessageContext('default', 'id', $trigger, new \DateTimeImmutable('2026-11-14 00:00:00 UTC'))) as $message) {
                $this->assertInstanceOf(RedispatchMessage::class, $message);
                $this->assertSame('async', $message->transportNames);
                $inner = $message->envelope;
                $this->assertInstanceOf(RunScheduledTask::class, $inner);
                $entries[] = [$inner->task, (string) $trigger, 'async'];
            }
        }

        return $entries;
    }

    public function testEveryTaskIsScheduledExactlyOnceWithItsCron(): void
    {
        self::bootKernel();
        $schedule = self::getContainer()->get(MainSchedule::class)->getSchedule();

        $entries = $this->entries($schedule);
        $tasks = array_map(static fn (array $e): ScheduledTask => $e[0], $entries);
        $this->assertCount(count(ScheduledTask::cases()), $entries);
        foreach (ScheduledTask::cases() as $case) {
            $this->assertCount(1, array_filter($tasks, static fn (ScheduledTask $t): bool => $t === $case), $case->value);
        }
        foreach ($entries as [$task, $cron]) {
            $this->assertSame($task->cron(), $cron);
        }
        $this->assertTrue($schedule->shouldProcessOnlyLastMissedRun());
        $this->assertNotNull($schedule->getLock());
        $this->assertNotNull($schedule->getState());
    }

    public function testCronTimesAreUniqueAndInTheNightWindow(): void
    {
        $crons = array_map(static fn (ScheduledTask $t): string => $t->cron(), ScheduledTask::cases());
        $this->assertSame($crons, array_values(array_unique($crons)));
        foreach (ScheduledTask::cases() as $task) {
            [$minute, $hour] = explode(' ', $task->cron());
            $this->assertGreaterThanOrEqual(2, (int) $hour);
            $this->assertLessThan(4, (int) $hour);
            $this->assertMatchesRegularExpression('/^\d+$/', $minute);
        }
    }

    public function testDisabledSchedulerYieldsAnEmptySchedule(): void
    {
        self::bootKernel();
        $c = self::getContainer();
        $provider = new MainSchedule(new LockFactory(new InMemoryStore()), $c->get('scheduler_state'), false);
        $this->assertInstanceOf(CacheInterface::class, $c->get('scheduler_state'));
        $this->assertSame([], $provider->getSchedule()->getRecurringMessages());
    }

    public function testMessageIsRoutedToAsyncTransport(): void
    {
        self::bootKernel();
        $bus = self::getContainer()->get('messenger.default_bus');
        $bus->dispatch(new RunScheduledTask(ScheduledTask::PruneAuthNonces));
        $transport = self::getContainer()->get('messenger.transport.async');
        $this->assertCount(1, $transport->getSent());
    }
}
