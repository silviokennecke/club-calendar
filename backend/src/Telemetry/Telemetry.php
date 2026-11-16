<?php

declare(strict_types=1);

namespace App\Telemetry;

use Nyholm\Psr7\Factory\Psr17Factory;
use OpenTelemetry\API\Behavior\Internal\Logging;
use OpenTelemetry\API\Metrics\CounterInterface;
use OpenTelemetry\API\Metrics\GaugeInterface;
use OpenTelemetry\API\Metrics\MeterInterface;
use OpenTelemetry\API\Metrics\Noop\NoopMeter;
use OpenTelemetry\Contrib\Otlp\MetricExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Export\Http\PsrTransportFactory;
use OpenTelemetry\SDK\Metrics\MeterProvider;
use OpenTelemetry\SDK\Metrics\MeterProviderBuilder;
use OpenTelemetry\SDK\Metrics\MetricExporterInterface;
use OpenTelemetry\SDK\Metrics\MetricReader\ExportingReader;
use OpenTelemetry\SDK\Metrics\TemporalityPreference;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpClient\HttpClient;
use Symfony\Component\HttpClient\Psr18Client;

/**
 * Optional OpenTelemetry metrics. Disabled (no endpoint) = no-op instruments, the SDK is never loaded.
 * Nothing here ever throws: a broken collector must not affect requests or jobs.
 */
class Telemetry
{
    public const METER_NAME = 'club-calendar';

    private ?MeterInterface $meter = null;
    private ?MeterProvider $provider = null;
    private bool $failed = false;
    private float $lastFlush = 0.0;

    /** @var array<string, CounterInterface|GaugeInterface> */
    private array $instruments = [];

    public function __construct(
        private readonly TelemetryConfig $config,
        private readonly ?LoggerInterface $logger = null,
        private readonly ?MetricExporterInterface $exporter = null,
    ) {
    }

    public function isEnabled(): bool
    {
        return $this->config->isEnabled() && !$this->failed;
    }

    public function counter(string $name, string $unit = '', string $description = ''): CounterInterface
    {
        $key = 'c:'.$name;
        try {
            $instrument = $this->instruments[$key] ??= $this->meter()->createCounter($name, '' === $unit ? null : $unit, '' === $description ? null : $description);
            \assert($instrument instanceof CounterInterface);

            return $instrument;
        } catch (\Throwable $e) {
            $this->warn($e);

            return $this->instruments[$key] = (new NoopMeter())->createCounter($name);
        }
    }

    public function gauge(string $name, string $unit = '', string $description = ''): GaugeInterface
    {
        $key = 'g:'.$name;
        try {
            $instrument = $this->instruments[$key] ??= $this->meter()->createGauge($name, '' === $unit ? null : $unit, '' === $description ? null : $description);
            \assert($instrument instanceof GaugeInterface);

            return $instrument;
        } catch (\Throwable $e) {
            $this->warn($e);

            return $this->instruments[$key] = (new NoopMeter())->createGauge($name);
        }
    }

    public function flush(): void
    {
        if (null === $this->provider) {
            return;
        }
        $this->lastFlush = microtime(true);
        try {
            $this->provider->forceFlush();
        } catch (\Throwable $e) {
            $this->warn($e);
        }
    }

    /** For idle loops: flush at most once per interval. */
    public function flushIfDue(float $minIntervalSeconds): void
    {
        if (null !== $this->provider && microtime(true) - $this->lastFlush >= $minIntervalSeconds) {
            $this->flush();
        }
    }

    private function meter(): MeterInterface
    {
        if (null !== $this->meter) {
            return $this->meter;
        }
        if (!$this->isEnabled()) {
            return $this->meter = new NoopMeter();
        }
        try {
            Logging::disable();
            $provider = $this->buildProvider();
            $this->provider = $provider;

            return $this->meter = $provider->getMeter(self::METER_NAME);
        } catch (\Throwable $e) {
            $this->failed = true;
            $this->warn($e);

            return $this->meter = new NoopMeter();
        }
    }

    private function buildProvider(): MeterProvider
    {
        $exporter = $this->exporter ?? $this->buildExporter();
        $attributes = ['service.name' => $this->config->serviceName]
            + TelemetryConfig::parsePairs($this->config->resourceAttributes);

        $provider = (new MeterProviderBuilder())
            ->setResource(ResourceInfo::create(Attributes::create($attributes)))
            ->addReader(new ExportingReader($exporter))
            ->build();
        \assert($provider instanceof MeterProvider);

        return $provider;
    }

    private function buildExporter(): MetricExporterInterface
    {
        $timeout = max(1, $this->config->timeoutMs) / 1000;
        $psr17 = new Psr17Factory();
        $client = new Psr18Client(HttpClient::create(['timeout' => $timeout, 'max_duration' => $timeout]), $psr17, $psr17);
        $compression = 'gzip' === strtolower($this->config->compression) ? 'gzip' : null;

        $transport = (new PsrTransportFactory($client, $psr17, $psr17))->create(
            $this->config->metricsUrl(),
            'application/x-protobuf',
            TelemetryConfig::parsePairs($this->config->headers),
            $compression,
            $timeout,
            0,
            0,
        );

        return new MetricExporter($transport, TemporalityPreference::fromName($this->config->temporality));
    }

    private function warn(\Throwable $e): void
    {
        try {
            $this->logger?->warning('Telemetry failed', ['exception' => $e::class]);
        } catch (\Throwable) {
        }
    }
}
