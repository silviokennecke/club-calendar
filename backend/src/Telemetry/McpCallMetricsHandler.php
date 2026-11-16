<?php

declare(strict_types=1);

namespace App\Telemetry;

use App\Mcp\McpContext;
use Mcp\Capability\Registry\ElementReference;
use Mcp\Capability\Registry\ReferenceHandlerInterface;
use Mcp\Schema\Request\CallToolRequest;

/**
 * Counts every tool call once, around the SDK's reference handler (the one place all tools pass through, so a new
 * tool is counted without any change). `access` is the scope the tool asked for via McpContext::requireScope().
 */
final class McpCallMetricsHandler implements ReferenceHandlerInterface
{
    public const NAME = 'club_calendar.mcp.calls';

    public function __construct(
        private readonly ReferenceHandlerInterface $inner,
        private readonly Telemetry $telemetry,
        private readonly McpContext $context,
    ) {
    }

    public function handle(ElementReference $reference, array $arguments): mixed
    {
        $request = $arguments['_request'] ?? null;
        if (!$request instanceof CallToolRequest) {
            return $this->inner->handle($reference, $arguments);
        }

        $this->context->resetRequiredScope();
        try {
            $result = $this->inner->handle($reference, $arguments);
        } catch (\Throwable $e) {
            $this->record($request->name, 'error');
            throw $e;
        }
        $this->record($request->name, 'ok');

        return $result;
    }

    private function record(string $tool, string $outcome): void
    {
        try {
            $this->telemetry->counter(self::NAME, '{call}', 'MCP tool calls')->add(1, [
                'tool' => $tool,
                'access' => $this->context->requiredScope() ?? 'unknown',
                'outcome' => $outcome,
            ]);
        } catch (\Throwable) {
        }
    }
}
