<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\OpaqueCutoff;
use App\Opaque\OpaqueException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class OpaqueCutoffTest extends TestCase
{
    public function testCutoffStartsAtMidnightUtc(): void
    {
        $cutoff = new OpaqueCutoff('2026-12-31');
        $utc = new \DateTimeZone('UTC');

        self::assertFalse($cutoff->cutoffReached(new \DateTimeImmutable('2026-12-30 23:59:59', $utc)));
        self::assertTrue($cutoff->cutoffReached(new \DateTimeImmutable('2026-12-31 00:00:00', $utc)));
    }

    public function testNoCutoffIsNeverReached(): void
    {
        $cutoff = new OpaqueCutoff('');

        self::assertNull($cutoff->cutoff());
        self::assertFalse($cutoff->cutoffReached(new \DateTimeImmutable('2999-01-01', new \DateTimeZone('UTC'))));
    }

    /** @return iterable<string, array{string}> */
    public static function invalid(): iterable
    {
        yield 'dd.mm.yyyy' => ['31.12.2026'];
        yield 'month 13' => ['2026-13-01'];
        yield 'trailing' => ['2026-12-31 '];
    }

    #[DataProvider('invalid')]
    public function testInvalidValuesAreRejected(string $cutoff): void
    {
        $this->expectException(OpaqueException::class);
        new OpaqueCutoff($cutoff);
    }
}
