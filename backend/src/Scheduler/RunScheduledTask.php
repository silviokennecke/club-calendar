<?php

declare(strict_types=1);

namespace App\Scheduler;

final readonly class RunScheduledTask
{
    public function __construct(public ScheduledTask $task)
    {
    }
}
