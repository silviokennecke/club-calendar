<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Logging\OtelLogHandler;
use App\Telemetry\Telemetry;
use App\Telemetry\TelemetryConfig;
use Monolog\Logger;
use OpenTelemetry\SDK\Logs\Exporter\InMemoryExporter as LogExporter;
use OpenTelemetry\SDK\Metrics\MetricExporter\InMemoryExporter;
use PHPUnit\Framework\TestCase;

/** The MCP SDK runs tool calls in fibers; OTel warns on implicit context access in a fiber without a context. */
final class FiberSafetyTest extends TestCase
{
    private function runInFiber(callable $fn): void
    {
        set_error_handler(static function (int $no, string $msg): never {
            throw new \ErrorException($msg, 0, $no);
        });
        try {
            $fiber = new \Fiber($fn);
            $fiber->start();
            self::assertTrue($fiber->isTerminated());
        } finally {
            restore_error_handler();
        }
    }

    public function testCounterAndGaugeInsideFreshFiber(): void
    {
        $config = new TelemetryConfig('http://x');
        $storage = new \ArrayObject();
        $t = new Telemetry($config, null, new InMemoryExporter($storage, $config->temporality));

        $this->runInFiber(function () use ($t): void {
            $t->counter('club_calendar.mcp.calls', '{call}')->add(1, ['tool' => 'list_clubs', 'outcome' => 'ok']);
            $t->gauge('club_calendar.g')->record(4, ['k' => 'v']);
            $t->flush();
        });

        $seen = [];
        foreach ($storage as $metric) {
            foreach ($metric->data->dataPoints as $p) {
                $seen[$metric->name] = [$p->attributes->toArray(), $p->value];
            }
        }
        self::assertSame([['tool' => 'list_clubs', 'outcome' => 'ok'], 1], $seen['club_calendar.mcp.calls']);
        self::assertSame([['k' => 'v'], 4], $seen['club_calendar.g']);
    }

    public function testLogHandlerInsideFreshFiber(): void
    {
        $config = new TelemetryConfig('http://x');
        $storage = new \ArrayObject();
        $t = new Telemetry($config, null, null, new LogExporter($storage));
        $logger = new Logger('app');
        $logger->pushHandler(new OtelLogHandler($config, $t));

        $this->runInFiber(function () use ($logger, $t): void {
            $logger->error('boom', ['k' => 'v']);
            $t->flush();
        });

        self::assertCount(1, $storage);
        self::assertSame(['boom'], array_map(static fn ($r) => $r->getBody(), $storage->getArrayCopy()));
    }
}
