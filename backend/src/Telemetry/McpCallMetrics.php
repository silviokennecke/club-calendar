<?php

declare(strict_types=1);

namespace App\Telemetry;

/**
 * Zero-seeds the MCP call counter for every registered tool and outcome. The label space is small and static
 * (the tool list comes from the container, the access of a tool is fixed), and a Prometheus-style store cannot
 * see the first sample of a new series in increase(): without the zero a first call of a tool would vanish.
 */
final class McpCallMetrics
{
    /** @param array<string, string> $tools tool name => read|write, set by McpCallMetricsPass */
    public function __construct(
        private readonly Telemetry $telemetry,
        private readonly array $tools = [],
    ) {
    }

    public function initialize(): void
    {
        try {
            $counter = $this->telemetry->counter(McpCallMetricsHandler::NAME, '{call}', 'MCP tool calls');
            foreach ($this->tools as $tool => $access) {
                foreach (['ok', 'error'] as $outcome) {
                    $counter->add(0, ['tool' => $tool, 'access' => $access, 'outcome' => $outcome]);
                }
            }
        } catch (\Throwable) {
        }
    }
}
