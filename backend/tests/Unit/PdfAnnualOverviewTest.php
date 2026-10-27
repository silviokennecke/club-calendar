<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfAnnualOverview;
use App\Pdf\PdfLayout;
use PHPUnit\Framework\TestCase;

class PdfAnnualOverviewTest extends TestCase
{
    private function d(string $s): \DateTimeImmutable
    {
        return new \DateTimeImmutable($s);
    }

    /** @param list<array{number: int, hasEvents: bool}|null> $cells */
    private static function days(array $cells): int
    {
        return count(array_filter($cells));
    }

    public function testTwelveMonthsWithAllDays(): void
    {
        $months = PdfAnnualOverview::build(2026, 1, [], 'en');
        self::assertCount(12, $months);
        self::assertSame('January', $months[0]['label']);
        self::assertSame('December', $months[11]['label']);
        self::assertSame(365, array_sum(array_map(fn (array $m): int => self::days(array_merge(...$m['weeks'])), $months)));
    }

    public function testLeapYearFebruary(): void
    {
        self::assertSame(29, self::days(array_merge(...PdfAnnualOverview::build(2028, 1, [], 'en')[1]['weeks'])));
        self::assertSame(28, self::days(array_merge(...PdfAnnualOverview::build(2026, 1, [], 'en')[1]['weeks'])));
    }

    public function testWeekdayOffsetsFollowFirstDay(): void
    {
        // 1 Jan 2026 is a Thursday: 3 empty cells with Monday first, 4 with Sunday first
        $mon = PdfAnnualOverview::build(2026, 1, [], 'en')[0]['weeks'][0];
        $sun = PdfAnnualOverview::build(2026, 0, [], 'en')[0]['weeks'][0];
        self::assertSame([null, null, null], array_slice($mon, 0, 3));
        self::assertSame(1, $mon[3]['number']);
        self::assertSame([null, null, null, null], array_slice($sun, 0, 4));
        self::assertSame(1, $sun[4]['number']);
        // 1 Feb 2026 is a Sunday: last cell with Monday first, first cell with Sunday first
        self::assertSame(1, PdfAnnualOverview::build(2026, null, [], 'en')[1]['weeks'][0][6]['number']);
        self::assertSame(1, PdfAnnualOverview::build(2026, 0, [], 'en')[1]['weeks'][0][0]['number']);
    }

    public function testDaysWithEventsAreMarked(): void
    {
        $entries = [
            ['day' => $this->d('2026-03-05'), 'id' => 'a'],
            ['day' => $this->d('2026-03-05'), 'id' => 'b'],
            ['day' => $this->d('2026-12-31'), 'id' => 'c'],
        ];
        $months = PdfAnnualOverview::build(2026, 1, $entries, 'en');
        $marked = [];
        foreach ($months as $m) {
            foreach (array_filter(array_merge(...$m['weeks'])) as $cell) {
                if ($cell['hasEvents']) {
                    $marked[] = $m['month'].'-'.$cell['number'];
                }
            }
        }
        self::assertSame(['3-5', '12-31'], $marked);
    }

    public function testEventListAddsDateLabels(): void
    {
        $list = PdfAnnualOverview::eventList([['day' => $this->d('2026-03-05'), 'id' => 'a']], 'en');
        self::assertSame('Th, Mar 5, 2026', $list[0]['dateLabel']);
    }

    public function testAvailableOnlyForFullCalendarYear(): void
    {
        self::assertTrue(PdfLayout::AnnualOverview->available($this->d('2026-01-01'), $this->d('2026-12-31')));
        self::assertTrue(PdfLayout::AnnualOverview->available($this->d('2028-01-01'), $this->d('2028-12-31')));
        self::assertFalse(PdfLayout::AnnualOverview->available($this->d('2026-01-02'), $this->d('2026-12-31')));
        self::assertFalse(PdfLayout::AnnualOverview->available($this->d('2026-01-01'), $this->d('2026-12-30')));
        self::assertFalse(PdfLayout::AnnualOverview->available($this->d('2026-07-01'), $this->d('2027-06-30')));
    }
}
