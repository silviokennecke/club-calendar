<?php

declare(strict_types=1);

namespace App\Scheduler;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Messenger\Message\RedispatchMessage;
use Symfony\Component\Scheduler\Attribute\AsSchedule;
use Symfony\Component\Scheduler\RecurringMessage;
use Symfony\Component\Scheduler\Schedule;
use Symfony\Component\Scheduler\ScheduleProviderInterface;
use Symfony\Contracts\Cache\CacheInterface;

/** The scheduler process only enqueues RunScheduledTask on the async transport; workers execute it. */
#[AsSchedule('default')]
final class MainSchedule implements ScheduleProviderInterface
{
    public function __construct(
        #[Autowire(service: 'app.scheduler_lock_factory')]
        private readonly LockFactory $lockFactory,
        #[Autowire(service: 'scheduler_state')]
        private readonly CacheInterface $state,
        #[Autowire('%env(bool:SCHEDULER_ENABLED)%')]
        private readonly bool $enabled,
    ) {
    }

    public function getSchedule(): Schedule
    {
        $schedule = new Schedule();
        if (!$this->enabled) {
            return $schedule;
        }

        foreach (ScheduledTask::cases() as $task) {
            $schedule->add(RecurringMessage::cron(
                $task->cron(),
                new RedispatchMessage(new RunScheduledTask($task), 'async'),
                new \DateTimeZone('UTC'),
            ));
        }

        return $schedule
            ->lock($this->lockFactory->createLock('scheduler_default'))
            ->stateful($this->state)
            ->processOnlyLastMissedRun(true);
    }
}
