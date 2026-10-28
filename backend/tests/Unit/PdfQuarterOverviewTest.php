<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfLayout;
use App\Pdf\PdfQuarterOverview;
use PHPUnit\Framework\TestCase;

class PdfQuarterOverviewTest extends TestCase
{
    private const float HEIGHT = 500.0;
    private const float WIDTH = 774.0;

    private function d(string $s): \DateTimeImmutable
    {
        return new \DateTimeImmutable($s);
    }

    /**
     * @param array<string, mixed> $extra
     *
     * @return array<string, mixed>
     */
    private function entry(string $date, string $name, array $extra = []): array
    {
        return $extra + [
            'id' => $name.$date, 'day' => $this->d($date), 'name' => $name, 'allDay' => false, 'begin' => '18:00',
            'features' => [], 'emojiPaths' => [], 'draft' => false,
        ];
    }

    /**
     * @param list<array<string, mixed>> $entries
     *
     * @return list<array<string, mixed>>
     */
    private function pages(string $from, string $to, array $entries = [], float $height = self::HEIGHT): array
    {
        return PdfQuarterOverview::build($this->d($from), $this->d($to), $entries, 'en', $height, self::WIDTH);
    }

    /** @return list<list<string>> */
    private function labels(string $from, string $to): array
    {
        return array_map(static fn (array $page): array => array_column($page['months'], 'label'), $this->pages($from, $to));
    }

    public function testFullYearIsFourPagesOfThreeMonths(): void
    {
        $pages = $this->labels('2026-01-01', '2026-12-31');
        self::assertCount(4, $pages);
        self::assertSame(['January 2026', 'February 2026', 'March 2026'], $pages[0]);
        self::assertSame(['October 2026', 'November 2026', 'December 2026'], $pages[3]);
    }

    public function testRangeAcrossYearBoundaryAndSingleLeftover(): void
    {
        self::assertSame([['November 2026', 'December 2026', 'January 2027'], ['February 2027', 'March 2027']], $this->labels('2026-11-20', '2027-03-01'));
        self::assertSame(['April 2026'], $this->labels('2026-01-31', '2026-04-01')[1]);
    }

    public function testAvailabilityNeedsThreeTouchedMonths(): void
    {
        self::assertFalse(PdfLayout::QuarterOverview->available($this->d('2026-01-15'), $this->d('2026-02-20')));
        self::assertTrue(PdfLayout::QuarterOverview->available($this->d('2026-01-31'), $this->d('2026-03-01')));
        self::assertTrue(PdfLayout::QuarterOverview->available($this->d('2026-11-30'), $this->d('2027-01-01')));
    }

    public function testEveryMonthHasThirtyOneRowsWithGreyFillersAndOutOfRangeDays(): void
    {
        $month = $this->pages('2026-02-10', '2026-04-20')[0]['months'][0];
        self::assertCount(31, $month['rows']);
        $kinds = array_column($month['rows'], 'kind');
        self::assertSame(array_fill(0, 9, 'grey'), array_slice($kinds, 0, 9), 'Feb 1-9 are before from');
        self::assertSame('day', $kinds[9]);
        self::assertSame(['grey', 'grey', 'grey'], array_slice($kinds, 28), 'Feb 29-31 do not exist');
        self::assertArrayNotHasKey('events', $month['rows'][0]);

        $april = $this->pages('2026-02-10', '2026-04-20')[0]['months'][2];
        self::assertSame('day', $april['rows'][19]['kind']);
        self::assertSame('grey', $april['rows'][20]['kind']);
    }

    public function testEventsOutsideTheRangeAreNotDrawn(): void
    {
        $pages = $this->pages('2026-02-10', '2026-04-20', [$this->entry('2026-02-05', 'Zu frueh')]);
        self::assertSame([], $pages[0]['eventIds']);
        self::assertArrayNotHasKey('events', $pages[0]['months'][0]['rows'][4]);
    }

    public function testWeekendFlagsAndWeekdayLabels(): void
    {
        $rows = $this->pages('2026-07-01', '2026-09-30')[0]['months'][0]['rows'];
        self::assertSame('We', $rows[0]['weekday']);
        self::assertFalse($rows[0]['weekend']);
        self::assertSame(['Sa', true], [$rows[3]['weekday'], $rows[3]['weekend']]);
        self::assertSame(['Su', true], [$rows[4]['weekday'], $rows[4]['weekend']]);
        self::assertFalse($rows[5]['weekend']);
        self::assertSame(1, $rows[0]['number']);
    }

    public function testEventLinesKeepOrderAndRowsGrowWithEvents(): void
    {
        $entries = [];
        foreach (['A', 'B', 'C', 'D'] as $n) {
            $entries[] = $this->entry('2026-07-04', "Event $n", ['features' => 'A' === $n ? ['Bonus', 'Wertung'] : [], 'draft' => 'B' === $n]);
        }
        $entries[] = $this->entry('2026-07-05', 'Ganztag', ['allDay' => true, 'begin' => null, 'emojiPaths' => ['/p/emoji_u1f389.png']]);
        $rows = $this->pages('2026-07-01', '2026-09-30', $entries)[0]['months'][0]['rows'];

        self::assertSame(4, $rows[3]['lines']);
        self::assertSame(['18:00', 'Event A (Bonus, Wertung)'], [$rows[3]['events'][0]['time'], $rows[3]['events'][0]['text']]);
        self::assertSame(['Bonus', 'Wertung'], $rows[3]['events'][0]['features']);
        self::assertSame('Event B', $rows[3]['events'][1]['text']);
        self::assertTrue($rows[3]['events'][1]['draft']);
        self::assertSame(2, $rows[4]['lines'], 'minimum of two lines');
        self::assertNull($rows[4]['events'][0]['time']);
        self::assertSame(['/p/emoji_u1f389.png'], $rows[4]['events'][0]['emojiPaths']);
        self::assertSame(2, $rows[0]['lines']);
    }

    public function testLongLinesAreCutWithEllipsis(): void
    {
        $name = str_repeat('Sehr langer Veranstaltungsname ', 8);
        $rows = $this->pages('2026-07-01', '2026-09-30', [$this->entry('2026-07-04', $name, ['features' => ['Bonusschießen']])])[0]['months'][0]['rows'];
        $text = $rows[3]['events'][0]['text'];
        self::assertStringEndsWith('…', $text);
        self::assertLessThan(mb_strlen($name), mb_strlen($text));
        self::assertStringStartsWith('Sehr langer', $text);
    }

    public function testFontScaleIsBoundedAndMonotonic(): void
    {
        self::assertSame(PdfQuarterOverview::MAX_FONT_PT, PdfQuarterOverview::fontFor(1, self::HEIGHT));
        self::assertSame(PdfQuarterOverview::MIN_FONT_PT, PdfQuarterOverview::fontFor(100000, self::HEIGHT));
        $previous = PHP_FLOAT_MAX;
        foreach ([40, 62, 80, 100, 140, 200, 400] as $lines) {
            $font = PdfQuarterOverview::fontFor($lines, self::HEIGHT);
            self::assertLessThanOrEqual($previous, $font);
            self::assertGreaterThanOrEqual(PdfQuarterOverview::MIN_FONT_PT, $font);
            self::assertLessThanOrEqual(PdfQuarterOverview::MAX_FONT_PT, $font);
            $previous = $font;
        }
        self::assertGreaterThan(PdfQuarterOverview::fontFor(80, self::HEIGHT), PdfQuarterOverview::fontFor(80, 900.0));
    }

    public function testBusiestMonthSetsTheScaleForAllColumnsAndColumnsEndEqually(): void
    {
        $empty = $this->pages('2026-07-01', '2026-09-30')[0];
        $entries = [];
        foreach (range(1, 40) as $i) {
            $entries[] = $this->entry('2026-08-10', "E$i");
        }
        $busy = $this->pages('2026-07-01', '2026-09-30', $entries)[0];

        self::assertLessThan($empty['fontPt'], $busy['fontPt']);
        self::assertEqualsWithDelta($busy['fontPt'] * 1.15, $busy['lineHeightPt'], 0.01);
        self::assertEqualsWithDelta(2 * $busy['lineHeightPt'], $busy['rowHeightPt'], 0.01);
        $totals = array_map(static fn (array $m): int => array_sum(array_column($m['rows'], 'lines')), $busy['months']);
        self::assertCount(1, array_unique($totals), 'filler rows make all columns equally tall');
        self::assertSame(31 * 2 + 38, $totals[0]);
    }

    public function testEventIdsOfThePageOnlyListEventsWithIcons(): void
    {
        $entries = [
            $this->entry('2026-07-04', 'Mit', ['emojiPaths' => ['/p/a.png']]),
            $this->entry('2026-07-05', 'Ohne'),
            $this->entry('2026-10-05', 'Naechste Seite', ['emojiPaths' => ['/p/b.png']]),
        ];
        $pages = $this->pages('2026-07-01', '2026-12-31', $entries);
        self::assertSame(['Mit2026-07-04'], $pages[0]['eventIds']);
        self::assertSame(['Naechste Seite2026-10-05'], $pages[1]['eventIds']);
    }
}
