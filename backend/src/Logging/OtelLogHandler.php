<?php

declare(strict_types=1);

namespace App\Logging;

use App\Telemetry\Telemetry;
use App\Telemetry\TelemetryConfig;
use Monolog\Handler\AbstractProcessingHandler;
use Monolog\Level;
use Monolog\LogRecord;
use OpenTelemetry\Contrib\Logs\Monolog\Handler;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Exports log records over OTLP. A no-op unless telemetry and logs are enabled: neither the SDK nor the provider
 * is touched then. Never throws and always bubbles, so the other handlers behave as without it.
 */
final class OtelLogHandler extends AbstractProcessingHandler
{
    private ?Handler $inner = null;

    // Lazy: Telemetry itself takes a logger, which would otherwise be a construction cycle.
    public function __construct(
        private readonly TelemetryConfig $config,
        #[Autowire(lazy: true)] private readonly Telemetry $telemetry,
    ) {
        parent::__construct($config->monologLevel(), true);
    }

    public function isHandling(LogRecord $record): bool
    {
        return $this->config->logsEnabled() && $record->level->value >= $this->level->value && !Telemetry::isBusyNow();
    }

    public function handle(LogRecord $record): bool
    {
        try {
            if ($this->isHandling($record)) {
                parent::handle($record);
            }
        } catch (\Throwable) {
        }

        return false;
    }

    protected function write(LogRecord $record): void
    {
        try {
            if (null === $this->inner) {
                $provider = $this->telemetry->loggerProvider();
                if (null === $provider) {
                    return;
                }
                $this->inner = new Handler($provider, Level::Debug, true, new OtelLogFormatter());
            }
            $this->inner->handle($record->with(context: OtelLogFormatter::cap($record->context), extra: OtelLogFormatter::cap($record->extra)));
        } catch (\Throwable) {
        }
    }
}
