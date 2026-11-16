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
    ) {
        $this->endpoint = trim($endpoint);
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
