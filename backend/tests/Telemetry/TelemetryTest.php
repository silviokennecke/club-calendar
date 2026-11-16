<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Telemetry\Telemetry;
use App\Telemetry\TelemetryConfig;
use OpenTelemetry\SDK\Metrics\Data\Temporality;
use OpenTelemetry\SDK\Metrics\InstrumentType;
use OpenTelemetry\SDK\Metrics\MetricExporter\InMemoryExporter;
use OpenTelemetry\SDK\Metrics\TemporalityPreference;
use PHPUnit\Framework\TestCase;

final class TelemetryTest extends TestCase
{
    public function testDisabledIsNoop(): void
    {
        $t = new Telemetry(new TelemetryConfig(''));
        self::assertFalse($t->isEnabled());
        $t->counter('x', '1', 'd')->add(1);
        $t->gauge('y')->record(3);
        $t->flush();
        self::assertSame($t->counter('x'), $t->counter('x'));

        $off = new Telemetry(new TelemetryConfig('http://127.0.0.1:1', sdkDisabled: true));
        self::assertFalse($off->isEnabled());
        $off->counter('x')->add(1);
        $off->flush();
    }

    public function testUnreachableEndpointNeverThrowsNorBlocks(): void
    {
        $t = new Telemetry(new TelemetryConfig('http://127.0.0.1:1', timeoutMs: 500));
        self::assertTrue($t->isEnabled());
        $start = microtime(true);
        $t->counter('requests', '1')->add(1, ['route' => 'a']);
        $t->gauge('size')->record(5);
        $t->flush();
        $t->flush();
        self::assertLessThan(3.0, microtime(true) - $start);
    }

    public function testDefaultTemporalityIsDelta(): void
    {
        $config = new TelemetryConfig('http://x');
        self::assertSame('delta', $config->temporality);
        $pref = TemporalityPreference::fromName($config->temporality);
        $metric = $this->createStub(\OpenTelemetry\SDK\Metrics\MetricMetadataInterface::class);
        $metric->method('temporality')->willReturn(Temporality::CUMULATIVE);
        $metric->method('instrumentType')->willReturn(InstrumentType::COUNTER);
        self::assertSame(Temporality::DELTA, $pref->temporality($metric));
    }

    public function testRecordsAreDeltaAndExported(): void
    {
        $storage = new \ArrayObject();
        $exporter = new InMemoryExporter($storage, (new TelemetryConfig('http://x'))->temporality);
        $t = new Telemetry(new TelemetryConfig('http://x'), null, $exporter);
        $t->counter('hits')->add(2);
        $t->flush();
        $t->counter('hits')->add(3);
        $t->flush();
        self::assertCount(2, $storage);
        $sums = array_map(static fn ($m) => $m->data->dataPoints[0]->value, $storage->getArrayCopy());
        self::assertSame([2, 3], $sums);
        self::assertSame(Temporality::DELTA, $storage[0]->data->temporality);
    }

    public function testParsePairs(): void
    {
        self::assertSame(['a' => 'b c', 'k' => 'v'], TelemetryConfig::parsePairs('a=b%20c, k=v,bad'));
    }
}
