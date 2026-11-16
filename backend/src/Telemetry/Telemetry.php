<?php

declare(strict_types=1);

namespace App\Telemetry;

use Nyholm\Psr7\Factory\Psr17Factory;
use OpenTelemetry\API\Behavior\Internal\Logging;
use OpenTelemetry\API\Common\Time\Clock;
use OpenTelemetry\API\Logs\LoggerProviderInterface;
use OpenTelemetry\API\Metrics\CounterInterface;
use OpenTelemetry\API\Metrics\GaugeInterface;
use OpenTelemetry\API\Metrics\MeterInterface;
use OpenTelemetry\API\Metrics\Noop\NoopMeter;
use OpenTelemetry\Contrib\Otlp\LogsExporter;
use OpenTelemetry\Contrib\Otlp\MetricExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Export\Http\PsrTransportFactory;
use OpenTelemetry\SDK\Common\Export\TransportInterface;
use OpenTelemetry\SDK\Logs\LoggerProvider;
use OpenTelemetry\SDK\Logs\LogRecordExporterInterface;
use OpenTelemetry\SDK\Logs\Processor\BatchLogRecordProcessor;
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
    private ?LoggerProvider $logProvider = null;
    private bool $logsFailed = false;
    /** Set while telemetry itself runs, so its own log records never re-enter the log export. */
    private static bool $busy = false;
    private float $lastFlush = 0.0;

    /** @var array<string, CounterInterface|GaugeInterface> */
    private array $instruments = [];

    public function __construct(
        private readonly TelemetryConfig $config,
        private readonly ?LoggerInterface $logger = null,
        private readonly ?MetricExporterInterface $exporter = null,
        private readonly ?LogRecordExporterInterface $logExporter = null,
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
            $instrument = $this->instruments[$key] ??= new FiberSafeCounter(FiberSafeContext::run(fn () => $this->meter()->createCounter($name, '' === $unit ? null : $unit, '' === $description ? null : $description)));
            \assert($instrument instanceof CounterInterface);

            return $instrument;
        } catch (\Throwable $e) {
            $this->warn($e);

            return $this->instruments[$key] = new FiberSafeCounter((new NoopMeter())->createCounter($name));
        }
    }

    public function gauge(string $name, string $unit = '', string $description = ''): GaugeInterface
    {
        $key = 'g:'.$name;
        try {
            $instrument = $this->instruments[$key] ??= new FiberSafeGauge(FiberSafeContext::run(fn () => $this->meter()->createGauge($name, '' === $unit ? null : $unit, '' === $description ? null : $description)));
            \assert($instrument instanceof GaugeInterface);

            return $instrument;
        } catch (\Throwable $e) {
            $this->warn($e);

            return $this->instruments[$key] = new FiberSafeGauge((new NoopMeter())->createGauge($name));
        }
    }

    public static function isBusyNow(): bool
    {
        return self::$busy;
    }

    /** Null when logs are disabled or the provider could not be built. */
    public function loggerProvider(): ?LoggerProviderInterface
    {
        return FiberSafeContext::run(fn () => $this->buildLoggerProvider());
    }

    private function buildLoggerProvider(): ?LoggerProviderInterface
    {
        if (null !== $this->logProvider) {
            return $this->logProvider;
        }
        if (!$this->config->logsEnabled() || $this->logsFailed) {
            return null;
        }
        $previous = self::$busy;
        self::$busy = true;
        try {
            Logging::disable();
            $exporter = $this->logExporter ?? new LogsExporter($this->transport($this->config->logsUrl()));
            // autoFlush off and batch = queue: nothing is sent during a request, one request per flush
            $processor = new BatchLogRecordProcessor($exporter, Clock::getDefault(), 256, 1000, max(1, $this->config->timeoutMs), 256, false);

            return $this->logProvider = new LoggerProvider($processor, new \OpenTelemetry\SDK\Common\Instrumentation\InstrumentationScopeFactory(Attributes::factory()), $this->resource());
        } catch (\Throwable $e) {
            $this->logsFailed = true;
            $this->warn($e);

            return null;
        } finally {
            self::$busy = $previous;
        }
    }

    public function flush(): void
    {
        FiberSafeContext::run($this->doFlush(...));
    }

    private function doFlush(): void
    {
        if (null === $this->provider && null === $this->logProvider) {
            return;
        }
        $this->lastFlush = microtime(true);
        $previous = self::$busy;
        self::$busy = true;
        try {
            foreach ([$this->provider, $this->logProvider] as $provider) {
                try {
                    $provider?->forceFlush();
                } catch (\Throwable $e) {
                    $this->warn($e);
                }
            }
        } finally {
            self::$busy = $previous;
        }
    }

    /** For idle loops: flush at most once per interval. */
    public function flushIfDue(float $minIntervalSeconds): void
    {
        if ((null !== $this->provider || null !== $this->logProvider) && microtime(true) - $this->lastFlush >= $minIntervalSeconds) {
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

        $provider = (new MeterProviderBuilder())
            ->setResource($this->resource())
            ->addReader(new ExportingReader($exporter))
            ->build();
        \assert($provider instanceof MeterProvider);

        return $provider;
    }

    private function resource(): ResourceInfo
    {
        $attributes = ['service.name' => $this->config->serviceName]
            + TelemetryConfig::parsePairs($this->config->resourceAttributes);

        return ResourceInfo::create(Attributes::create($attributes));
    }

    private function buildExporter(): MetricExporterInterface
    {
        return new MetricExporter($this->transport($this->config->metricsUrl()), TemporalityPreference::fromName($this->config->temporality));
    }

    private function transport(string $url): TransportInterface
    {
        $timeout = max(1, $this->config->timeoutMs) / 1000;
        $psr17 = new Psr17Factory();
        $client = new Psr18Client(HttpClient::create(['timeout' => $timeout, 'max_duration' => $timeout]), $psr17, $psr17);
        $compression = 'gzip' === strtolower($this->config->compression) ? 'gzip' : null;

        return (new PsrTransportFactory($client, $psr17, $psr17))->create(
            $url,
            'application/x-protobuf',
            TelemetryConfig::parsePairs($this->config->headers),
            $compression,
            $timeout,
            0,
            0,
        );
    }

    private function warn(\Throwable $e): void
    {
        $previous = self::$busy;
        self::$busy = true;
        try {
            $this->logger?->warning('Telemetry failed', ['exception' => $e::class]);
        } catch (\Throwable) {
        } finally {
            self::$busy = $previous;
        }
    }
}
