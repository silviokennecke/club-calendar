<?php

declare(strict_types=1);

namespace App\DependencyInjection;

use App\Mcp\McpContext;
use App\Telemetry\McpCallMetrics;
use App\Telemetry\McpCallMetricsHandler;
use App\Telemetry\Telemetry;
use Mcp\Capability\Registry\ReferenceHandler;
use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Definition;
use Symfony\Component\DependencyInjection\Reference;

/** Wraps the reference handler of every MCP server builder (set up by the bundle's McpPass, which runs first). */
final class McpCallMetricsPass implements CompilerPassInterface
{
    public function process(ContainerBuilder $container): void
    {
        $tools = [];
        foreach ($container->getDefinitions() as $id => $builder) {
            if (!preg_match('/^mcp\.server\.[^.]+\.builder$/', $id)) {
                continue;
            }
            $inner = null;
            $calls = $builder->getMethodCalls();
            foreach ($calls as $i => [$method, $args]) {
                if ('addTool' === $method && \is_string($args[1] ?? null)) {
                    $tools[$args[1]] = self::isReadOnly($args[4] ?? null) ? 'read' : 'write';
                } elseif ('setReferenceHandler' === $method) {
                    $inner = $args[0];
                    unset($calls[$i]);
                } elseif ('setContainer' === $method && null === $inner) {
                    $locator = $args[0];
                }
            }
            if (null === $inner) {
                if (!isset($locator)) {
                    continue;
                }
                $inner = new Definition(ReferenceHandler::class, [$locator]);
            }
            $builder->setMethodCalls(array_values($calls));
            $builder->addMethodCall('setReferenceHandler', [
                new Definition(McpCallMetricsHandler::class, [$inner, new Reference(Telemetry::class), new Reference(McpContext::class)]),
            ]);
            unset($locator);
        }

        if ($container->hasDefinition(McpCallMetrics::class)) {
            $container->getDefinition(McpCallMetrics::class)->setArgument('$tools', $tools);
        }
    }

    /** Read tools declare readOnlyHint (the second ToolAnnotations argument); every tool without it is a write tool. */
    private static function isReadOnly(mixed $annotations): bool
    {
        if ($annotations instanceof Definition) {
            $args = $annotations->getArguments();

            return true === ($args[1] ?? $args['$readOnlyHint'] ?? null);
        }

        return \is_object($annotations) && true === ($annotations->readOnlyHint ?? null);
    }
}
