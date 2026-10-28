<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfEventLine;
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
        self::assertSame('E1', $cell['events'][0]['title']);
    }

    public function testEventLineHasTimeEmojiTitleAndFeatures(): void
    {
        $entry = $this->entry('2026-07-04', 'Pokal') + ['allDay' => false, 'begin' => '19:00', 'emojiPaths' => ['/a.png'], 'features' => ['Bonus', 'Wertung'], 'draft' => true];
        $e = $this->cell([$entry], 1000.0)['events'][0];
        self::assertSame('19:00', $e['time']);
        self::assertSame(['/a.png'], $e['emojiPaths']);
        self::assertSame('Pokal (Bonus, Wertung)', $e['text']);
        self::assertTrue($e['draft']);
    }

    public function testAllDayAndMissingTimeHaveNoTime(): void
    {
        $allDay = $this->entry('2026-07-04', 'A') + ['allDay' => true, 'begin' => '10:00'];
        $none = $this->entry('2026-07-04', 'B') + ['allDay' => false, 'begin' => null];
        $events = $this->cell([$allDay, $none])['events'];
        self::assertNull($events[0]['time']);
        self::assertNull($events[1]['time']);
        self::assertFalse($events[1]['draft']);
        self::assertSame([], $events[1]['features']);
    }

    public function testLongLinesAreCutWithinTheCellBudget(): void
    {
        $entry = $this->entry('2026-07-04', str_repeat('Mitgliederversammlung ', 6)) + ['allDay' => false, 'begin' => '19:00', 'emojiPaths' => ['/a.png', '/b.png'], 'features' => ['Bonusschießen']];
        foreach ([527.0, 842.0 - 68.0] as $width) {
            $e = $this->cell([$entry], $width)['events'][0];
            self::assertStringEndsWith('…', $e['text']);
            $cellEm = ($width / 7 - 7.0) / PdfMonthGrid::FONT_PT;
            $used = PdfEventLine::emWidth('19:00 ') + 2 * (1.1 + 1.0 / PdfMonthGrid::FONT_PT) + PdfEventLine::emWidth(' '.$e['text']);
            self::assertLessThanOrEqual($cellEm, $used);
        }
        $wide = $this->cell([$entry], 842.0 - 68.0)['events'][0]['text'];
        $narrow = $this->cell([$entry], 527.0)['events'][0]['text'];
        self::assertGreaterThan(mb_strlen($narrow), mb_strlen($wide));
    }

    public function testShortLineIsNotCut(): void
    {
        self::assertSame('Training', $this->cell([$this->entry('2026-07-04', 'Training')])['events'][0]['text']);
    }

    /** @param list<array<string, mixed>> $entries */
    private function cell(array $entries, float $width = 527.0): array
    {
        $m = PdfMonthGrid::build($this->d('2026-07-01'), $this->d('2026-07-31'), 1, $entries, 'en', 4, $width)[0];

        return array_column(array_filter(array_merge(...$m['weeks'])), null, 'number')[4];
    }
}
