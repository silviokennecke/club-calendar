<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfMonthGrid;
use PHPUnit\Framework\TestCase;

class PdfMonthGridTest extends TestCase
{
    private function entry(string $date, string $name = 'X'): array
    {
        return ['day' => new \DateTimeImmutable($date), 'name' => $name, 'id' => $name];
    }

    private function d(string $s): \DateTimeImmutable
    {
        return new \DateTimeImmutable($s);
    }

    public function testMondayFirstOffsetAndWeekCount(): void
    {
        // 2026-07-01 is a Wednesday
        $m = PdfMonthGrid::build($this->d('2026-07-01'), $this->d('2026-07-31'), 1, [], 'en')[0];
        self::assertCount(5, $m['weeks']);
        self::assertNull($m['weeks'][0][0]);
        self::assertNull($m['weeks'][0][1]);
        self::assertSame(1, $m['weeks'][0][2]['number']);
        self::assertSame(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], PdfMonthGrid::weekdayHeader(1, 'en'));
    }

    public function testSundayFirstOffset(): void
    {
        $m = PdfMonthGrid::build($this->d('2026-07-01'), $this->d('2026-07-31'), 0, [], 'en')[0];
        self::assertNull($m['weeks'][0][2]);
        self::assertSame(1, $m['weeks'][0][3]['number']);
        self::assertSame('Su', PdfMonthGrid::weekdayHeader(0, 'en')[0]);
    }

    public function testLeapFebruaryAndOutOfRangeDays(): void
    {
        $m = PdfMonthGrid::build($this->d('2028-02-10'), $this->d('2028-02-20'), 1, [$this->entry('2028-02-05'), $this->entry('2028-02-12')], 'en')[0];
        $cells = array_filter(array_merge(...$m['weeks']));
        self::assertCount(29, $cells);
        $byNumber = array_column($cells, null, 'number');
        self::assertFalse($byNumber[5]['inRange']);
        self::assertSame([], $byNumber[5]['events']);
        self::assertTrue($byNumber[12]['inRange']);
        self::assertCount(1, $byNumber[12]['events']);
    }

    public function testRangeSpanningYearBoundary(): void
    {
        $months = PdfMonthGrid::build($this->d('2026-12-20'), $this->d('2027-01-10'), 1, [], 'de');
        self::assertSame(['Dezember 2026', 'Januar 2027'], array_column($months, 'label'));
    }

    public function testOverflowShowsMoreCount(): void
    {
        $entries = [];
        foreach (range(1, 7) as $i) {
            $entries[] = $this->entry('2026-07-04', "E$i");
        }
        $m = PdfMonthGrid::build($this->d('2026-07-01'), $this->d('2026-07-31'), 1, $entries, 'en', 4)[0];
        $cell = array_column(array_filter(array_merge(...$m['weeks'])), null, 'number')[4];
        self::assertCount(4, $cell['events']);
        self::assertSame(3, $cell['more']);
        self::assertSame('E1', $cell['events'][0]['name']);
    }
}
