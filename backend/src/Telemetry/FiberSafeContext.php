<?php

declare(strict_types=1);

namespace App\Telemetry;

use OpenTelemetry\Context\Context;

/**
 * OpenTelemetry's fiber-bound context storage warns (E_USER_WARNING) on any read of the implicit context inside a
 * fiber that has none attached, and the MCP SDK runs tool calls in fibers. Inside a fiber the root context is
 * attached for the duration of the call, so nothing telemetry does can reach an uninitialised fiber context.
 */
final class FiberSafeContext
{
    /**
     * @template T
     *
     * @param callable(): T $fn
     *
     * @return T
     */
    public static function run(callable $fn): mixed
    {
        if (null === \Fiber::getCurrent()) {
            return $fn();
        }
        $scope = Context::getRoot()->activate();
        try {
            return $fn();
        } finally {
            $scope->detach();
        }
    }
}
