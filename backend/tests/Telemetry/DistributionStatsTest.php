<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Telemetry\DistributionStats;
use PHPUnit\Framework\TestCase;

final class DistributionStatsTest extends TestCase
{
    public function testEmptySetIsSkipped(): void
    {
        self::assertNull(DistributionStats::of([]));
    }

    public function testSingleValue(): void
    {
        self::assertSame(['avg' => 4.0, 'min' => 4.0, 'max' => 4.0, 'median' => 4.0, 'stddev' => 0.0], DistributionStats::of([4])->byStat());
    }

    public function testOddMedianAndUnsortedInput(): void
    {
        $s = DistributionStats::of([9, 1, 5])->byStat();
        self::assertSame(5.0, $s['median']);
        self::assertSame(1.0, $s['min']);
        self::assertSame(9.0, $s['max']);
        self::assertSame(5.0, $s['avg']);
    }

    public function testEvenMedianAndPopulationStddev(): void
    {
        $s = DistributionStats::of([2, 4, 4, 4, 5, 5, 7, 9])->byStat();
        self::assertSame(4.5, $s['median']);
        self::assertSame(5.0, $s['avg']);
        self::assertEqualsWithDelta(2.0, $s['stddev'], 1e-9);
    }
}
