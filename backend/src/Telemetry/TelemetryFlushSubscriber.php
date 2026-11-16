<?php

declare(strict_types=1);

namespace App\Telemetry;

use Symfony\Component\Console\Event\ConsoleTerminateEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\TerminateEvent;
use Symfony\Component\Messenger\Event\WorkerMessageFailedEvent;
use Symfony\Component\Messenger\Event\WorkerMessageHandledEvent;
use Symfony\Component\Messenger\Event\WorkerRunningEvent;

final class TelemetryFlushSubscriber implements EventSubscriberInterface
{
    private const IDLE_FLUSH_SECONDS = 15.0;

    public function __construct(private readonly Telemetry $telemetry)
    {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            TerminateEvent::class => ['onTerminate', -1024],
            ConsoleTerminateEvent::class => ['onConsoleTerminate', -1024],
            WorkerMessageHandledEvent::class => 'onMessage',
            WorkerMessageFailedEvent::class => 'onMessage',
            WorkerRunningEvent::class => 'onWorkerRunning',
        ];
    }

    public function onTerminate(TerminateEvent $event): void
    {
        if ($event->isMainRequest()) {
            $this->flush();
        }
    }

    public function onConsoleTerminate(ConsoleTerminateEvent $event): void
    {
        $this->flush();
    }

    public function onMessage(): void
    {
        $this->flush();
    }

    public function onWorkerRunning(WorkerRunningEvent $event): void
    {
        if ($event->isWorkerIdle() && $this->telemetry->isEnabled()) {
            $this->telemetry->flushIfDue(self::IDLE_FLUSH_SECONDS);
        }
    }

    private function flush(): void
    {
        if ($this->telemetry->isEnabled()) {
            $this->telemetry->flush();
        }
    }
}
