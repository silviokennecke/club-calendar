<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfLayout;
use App\Pdf\PdfQuarterOverview;
use PHPUnit\Framework\TestCase;

class PdfQuarterOverviewTest extends TestCase
{
    private function d(string $s): \DateTimeImmutable
    {
        return new \DateTimeImmutable($s);
    }

    /** @return list<list<string>> */
    private function labels(string $from, string $to): array
    {
        return array_map(
            static fn (array $page): array => array_column($page, 'label'),
            PdfQuarterOverview::build($this->d($from), $this->d($to), 1, [], 'en'),
        );
    }

    public function testFullYearIsFourPagesOfThreeMonths(): void
    {
        $pages = $this->labels('2026-01-01', '2026-12-31');
        self::assertCount(4, $pages);
        self::assertSame(['January 2026', 'February 2026', 'March 2026'], $pages[0]);
        self::assertSame(['October 2026', 'November 2026', 'December 2026'], $pages[3]);
    }

    public function testFiveMonthsAreTwoPagesLastWithTwo(): void
    {
        $pages = $this->labels('2026-03-15', '2026-07-02');
        self::assertCount(2, $pages);
        self::assertCount(3, $pages[0]);
        self::assertSame(['June 2026', 'July 2026'], $pages[1]);
    }

    public function testRangeAcrossYearBoundaryAndSingleLeftover(): void
    {
        $pages = $this->labels('2026-11-20', '2027-03-01');
        self::assertSame([['November 2026', 'December 2026', 'January 2027'], ['February 2027', 'March 2027']], $pages);
        self::assertCount(2, $this->labels('2026-01-31', '2026-04-01'));
        self::assertSame(['April 2026'], $this->labels('2026-01-31', '2026-04-01')[1]);
    }

    public function testAvailabilityNeedsThreeTouchedMonths(): void
    {
        self::assertFalse(PdfLayout::QuarterOverview->available($this->d('2026-01-15'), $this->d('2026-02-20')));
        self::assertTrue(PdfLayout::QuarterOverview->available($this->d('2026-01-31'), $this->d('2026-03-01')));
        self::assertTrue(PdfLayout::QuarterOverview->available($this->d('2026-11-30'), $this->d('2027-01-01')));
    }

    public function testCellsAreCappedAndNamesShortened(): void
    {
        $entries = [];
        foreach (range(1, 5) as $i) {
            $entries[] = ['day' => $this->d('2026-07-04'), 'name' => 'Sehr langer Veranstaltungsname '.$i, 'id' => (string) $i];
        }
        $month = PdfQuarterOverview::build($this->d('2026-07-01'), $this->d('2026-07-31'), 1, $entries, 'en')[0][0];
        $cell = array_column(array_filter(array_merge(...$month['weeks'])), null, 'number')[4];
        self::assertCount(3, $cell['events']);
        self::assertSame(2, $cell['more']);
        self::assertSame(16, mb_strlen($cell['events'][0]['cellName']));
    }
}
