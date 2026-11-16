<?php

declare(strict_types=1);

namespace App\Telemetry;

use OpenTelemetry\API\Metrics\CounterInterface;
use OpenTelemetry\Context\ContextInterface;

/** Counter that never looks up the implicit context (explicit root) and is safe to call inside a fiber. */
final class FiberSafeCounter implements CounterInterface
{
    public function __construct(private readonly CounterInterface $inner)
    {
    }

    public function isEnabled(): bool
    {
        return $this->inner->isEnabled();
    }

    public function add(float|int $amount, iterable $attributes = [], ContextInterface|false|null $context = null): void
    {
        FiberSafeContext::run(fn () => $this->inner->add($amount, $attributes, $context ?? false));
    }
}
