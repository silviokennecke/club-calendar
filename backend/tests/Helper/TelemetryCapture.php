<?php

declare(strict_types=1);

namespace App\Tests\Helper;

/** Enables telemetry for one test kernel and reads the exported counter points. */
trait TelemetryCapture
{
    private function enableTelemetry(bool $on = true): void
    {
        $value = $on ? 'http://telemetry.test' : '';
        putenv('OTEL_EXPORTER_OTLP_ENDPOINT='.$value);
        $_ENV['OTEL_EXPORTER_OTLP_ENDPOINT'] = $_SERVER['OTEL_EXPORTER_OTLP_ENDPOINT'] = $value;
    }

    private function resetTelemetryEnv(): void
    {
        putenv('OTEL_EXPORTER_OTLP_ENDPOINT');
        unset($_ENV['OTEL_EXPORTER_OTLP_ENDPOINT'], $_SERVER['OTEL_EXPORTER_OTLP_ENDPOINT']);
    }

    private function clearPoints(): void
    {
        static::getContainer()->get('test.telemetry.storage')->exchangeArray([]);
    }

    /** @return list<array{attrs: array<string, mixed>, value: int|float}> */
    private function points(string $metric): array
    {
        $out = [];
        foreach (static::getContainer()->get('test.telemetry.storage')->getArrayCopy() as $m) {
            if ($m->name !== $metric) {
                continue;
            }
            foreach ($m->data->dataPoints as $p) {
                $out[] = ['attrs' => $p->attributes->toArray(), 'value' => $p->value];
            }
        }

        return $out;
    }
}
