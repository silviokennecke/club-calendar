<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Ics\IcsEvent;
use App\Pdf\PdfMonthGrid;
use App\Pdf\PdfNotices;
use App\Pdf\PdfQuarterOverview;
use PHPUnit\Framework\TestCase;

class PdfNoticesTest extends TestCase
{
    private function ev(string $name, string $date, ?string $end = null, ?string $note = null, bool $draft = false): IcsEvent
    {
        return new IcsEvent('id-'.$name, $name, null, null, $date, $end, '00:00', '23:59', true, $draft, $note, null, [], [], [], []);
    }

    /** @return list<array<string, mixed>> */
    private function notices(IcsEvent ...$events): array
    {
        return PdfNotices::fromEvents(array_values($events), 'de');
    }

    public function testSingleDayShowsOneDateAndRangeShowsBoth(): void
    {
        [$a, $b] = $this->notices($this->ev('A', '2026-07-04'), $this->ev('B', '2026-07-10', '2026-07-20'));
        self::assertSame('04.07.2026', $a['dates']);
        self::assertSame('10.07.2026 – 20.07.2026', $b['dates']);
        self::assertSame('2026-07-20', $b['to']);
    }

    public function testNoteNewlinesCollapseAndEmojiAreStripped(): void
    {
        [$n] = $this->notices($this->ev("Ferien \u{1F389}", '2026-07-04', null, "  Zeile 1\r\nZeile 2\n\n  Zeile\t3 \u{1F600}"));
        self::assertSame('Zeile 1 Zeile 2 Zeile 3', $n['note']);
        self::assertSame('Ferien', $n['title']);
        self::assertSame('', $this->notices($this->ev('X', '2026-07-04'))[0]['note']);
    }

    public function testDraftFlagAndOrder(): void
    {
        $list = $this->notices($this->ev('Spaet', '2026-07-09', null, null, true), $this->ev('Frueh', '2026-07-01'));
        self::assertSame(['Frueh', 'Spaet'], array_column($list, 'title'));
        self::assertTrue($list[1]['draft']);
    }

    public function testTouchingMonthByOverlap(): void
    {
        $list = $this->notices($this->ev('Jun-Jul', '2026-06-28', '2026-07-03'), $this->ev('Aug', '2026-08-05'), $this->ev('Jul', '2026-07-15'));
        self::assertSame(['Jun-Jul', 'Jul'], array_column(PdfNotices::touching($list, '2026-07-01', '2026-07-31'), 'title'));
        self::assertSame(['Aug'], array_column(PdfNotices::touching($list, '2026-08-01', '2026-08-31'), 'title'));
    }

    public function testLongNoteWrapsIntoMoreLinesAndNothingIsDropped(): void
    {
        $short = $this->notices($this->ev('Kurz', '2026-07-04'))[0];
        $long = $this->notices($this->ev('Lang', '2026-07-04', null, str_repeat('Wort ', 400)))[0];
        self::assertSame(1, PdfNotices::lines($short, 8.0, 774.0));
        self::assertGreaterThan(3, PdfNotices::lines($long, 8.0, 774.0));
        self::assertStringContainsString('Wort', $long['note']);
    }

    public function testFitSplitsRemainderOff(): void
    {
        $list = $this->notices($this->ev('A', '2026-07-01'), $this->ev('B', '2026-07-02'), $this->ev('C', '2026-07-03'));
        [$on, $rest] = PdfNotices::fit($list, 8.0, 774.0, 2);
        self::assertSame(['A', 'B'], array_column($on, 'title'));
        self::assertSame(['C'], array_column($rest, 'title'));
    }

    public function testQuarterPageCarriesNoticesOfItsMonthsAndShrinksFont(): void
    {
        $list = $this->notices($this->ev('Ferien', '2026-07-10', '2026-07-12'), $this->ev('Spaeter', '2026-11-02'));
        $without = PdfQuarterOverview::build(new \DateTimeImmutable('2026-07-01'), new \DateTimeImmutable('2026-09-30'), [], 'de', 500.0, 774.0);
        $with = PdfQuarterOverview::build(new \DateTimeImmutable('2026-07-01'), new \DateTimeImmutable('2026-09-30'), [], 'de', 500.0, 774.0, [], $list);
        self::assertCount(1, $with);
        self::assertSame(['Ferien'], array_column($with[0]['notices'], 'title'));
        self::assertLessThanOrEqual($without[0]['fontPt'], $with[0]['fontPt']);
        self::assertSame([], $without[0]['notices']);
    }

    public function testQuarterManyNoticesOverflowToNoticePageWithoutLoss(): void
    {
        $events = [];
        for ($i = 1; $i <= 120; ++$i) {
            $events[] = $this->ev('N'.$i, '2026-07-'.sprintf('%02d', ($i % 28) + 1));
        }
        $pages = PdfQuarterOverview::build(new \DateTimeImmutable('2026-07-01'), new \DateTimeImmutable('2026-09-30'), [], 'de', 500.0, 774.0, [], $this->notices(...$events));
        $total = array_sum(array_map(static fn (array $p): int => count($p['notices']), $pages));
        self::assertSame(120, $total);
        self::assertSame([], end($pages)['months']);
        self::assertGreaterThanOrEqual(4.5, $pages[0]['fontPt']);
    }

    public function testMonthGridGetsNoticesOfThatMonthAndSmallerCells(): void
    {
        $list = $this->notices($this->ev('Juli', '2026-07-10'), $this->ev('Aug', '2026-08-10'));
        $months = PdfMonthGrid::build(new \DateTimeImmutable('2026-07-01'), new \DateTimeImmutable('2026-08-31'), 1, [], 'de', notices: $list);
        self::assertSame(['Juli'], array_column($months[0]['notices'], 'title'));
        self::assertSame(['Aug'], array_column($months[1]['notices'], 'title'));
        self::assertLessThanOrEqual(29.0, $months[0]['cellHeightMm']);
        $tight = PdfMonthGrid::build(new \DateTimeImmutable('2026-08-01'), new \DateTimeImmutable('2026-08-31'), 1, [], 'de', notices: $list, contentHeightPt: 400.0);
        self::assertLessThan(29.0, $tight[0]['cellHeightMm']);
        $plain = PdfMonthGrid::build(new \DateTimeImmutable('2026-07-01'), new \DateTimeImmutable('2026-08-31'), 1, [], 'de');
        self::assertNull($plain[0]['cellHeightMm']);
    }
}
