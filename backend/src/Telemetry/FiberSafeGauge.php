<?php

declare(strict_types=1);

namespace App\Telemetry;

use OpenTelemetry\API\Metrics\GaugeInterface;
use OpenTelemetry\Context\ContextInterface;

/** Gauge that never looks up the implicit context (explicit root) and is safe to call inside a fiber. */
final class FiberSafeGauge implements GaugeInterface
{
    public function __construct(private readonly GaugeInterface $inner)
    {
    }

    public function isEnabled(): bool
    {
        return $this->inner->isEnabled();
    }

    public function record(float|int $amount, iterable $attributes = [], ContextInterface|false|null $context = null): void
    {
        FiberSafeContext::run(fn () => $this->inner->record($amount, $attributes, $context ?? false));
    }
}
