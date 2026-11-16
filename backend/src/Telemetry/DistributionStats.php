<?php

declare(strict_types=1);

namespace App\Telemetry;

/** Summary statistics of one integer per entity (population standard deviation). */
final readonly class DistributionStats
{
    private function __construct(
        public float $avg,
        public float $min,
        public float $max,
        public float $median,
        public float $stddev,
    ) {
    }

    /** @param list<int|float> $values null for an empty set: nothing to report */
    public static function of(array $values): ?self
    {
        $n = count($values);
        if (0 === $n) {
            return null;
        }
        sort($values);
        $avg = array_sum($values) / $n;
        $variance = 0.0;
        foreach ($values as $v) {
            $variance += ($v - $avg) ** 2;
        }
        $mid = intdiv($n, 2);
        $median = 1 === $n % 2 ? (float) $values[$mid] : ($values[$mid - 1] + $values[$mid]) / 2;

        return new self($avg, (float) $values[0], (float) $values[$n - 1], (float) $median, sqrt($variance / $n));
    }

    /** @return array<string, float> value of the `stat` attribute => value */
    public function byStat(): array
    {
        return ['avg' => $this->avg, 'min' => $this->min, 'max' => $this->max, 'median' => $this->median, 'stddev' => $this->stddev];
    }
}
