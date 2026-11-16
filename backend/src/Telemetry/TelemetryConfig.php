<?php

declare(strict_types=1);

namespace App\Telemetry;

final readonly class TelemetryConfig
{
    public string $endpoint;

    public function __construct(
        string $endpoint = '',
        public bool $sdkDisabled = false,
        public string $serviceName = 'club-calendar',
        public string $resourceAttributes = '',
        public string $headers = '',
        public int $timeoutMs = 1000,
        public string $compression = 'none',
        public string $temporality = 'delta',
        string $logsExporter = 'otlp',
        string $logsLevel = 'warning',
    ) {
        $this->endpoint = trim($endpoint);
        $this->logsExporter = strtolower(trim($logsExporter));
        $level = strtolower(trim($logsLevel));
        $this->logsLevel = \in_array($level, self::LOG_LEVELS, true) ? $level : 'warning';
    }

    public const array LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

    public string $logsExporter;
    public string $logsLevel;

    /** Logs follow the same switch as metrics; OTEL_LOGS_EXPORTER=none turns off logs only. */
    public function logsEnabled(): bool
    {
        return $this->isEnabled() && 'none' !== $this->logsExporter;
    }

    public function logsUrl(): string
    {
        return rtrim($this->endpoint, '/').'/v1/logs';
    }

    public function monologLevel(): \Monolog\Level
    {
        return \Monolog\Level::fromName(ucfirst($this->logsLevel));
    }

    public function isEnabled(): bool
    {
        return '' !== $this->endpoint && !$this->sdkDisabled;
    }

    public function metricsUrl(): string
    {
        return rtrim($this->endpoint, '/').'/v1/metrics';
    }

    /**
     * @return array<string, string>
     */
    public static function parsePairs(string $list): array
    {
        $out = [];
        foreach (explode(',', $list) as $pair) {
            $pos = strpos($pair, '=');
            if (false === $pos) {
                continue;
            }
            $key = trim(substr($pair, 0, $pos));
            if ('' === $key) {
                continue;
            }
            $out[$key] = urldecode(trim(substr($pair, $pos + 1)));
        }

        return $out;
    }
}
