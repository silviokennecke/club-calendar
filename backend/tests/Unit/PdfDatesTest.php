<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfDates;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PdfDatesTest extends TestCase
{
    public function testMonthNamesAreLocalised(): void
    {
        self::assertSame('Oktober', PdfDates::monthName(2026, 10, 'de'));
        self::assertSame('October', PdfDates::monthName(2026, 10, 'en'));
        self::assertSame('Januar', PdfDates::monthName(2026, 1, 'de'));
        self::assertSame('December', PdfDates::monthName(2026, 12, 'en'));
    }

    public function testInvalidMonthIsRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        PdfDates::monthName(2026, 13, 'en');
    }

    /** @param list<int> $expected */
    #[DataProvider('weekdayOrderProvider')]
    public function testWeekdayOrder(?int $firstDayOfWeek, array $expected): void
    {
        self::assertSame($expected, PdfDates::weekdayOrder($firstDayOfWeek));
    }

    /** @return iterable<string, array{?int, list<int>}> */
    public static function weekdayOrderProvider(): iterable
    {
        yield 'sunday' => [0, [0, 1, 2, 3, 4, 5, 6]];
        yield 'monday' => [1, [1, 2, 3, 4, 5, 6, 0]];
        yield 'null falls back to monday' => [null, [1, 2, 3, 4, 5, 6, 0]];
        yield 'invalid value falls back to monday' => [9, [1, 2, 3, 4, 5, 6, 0]];
    }

    public function testWeekdayShortNames(): void
    {
        self::assertSame('So.', PdfDates::weekdayShort(0, 'de'));
        self::assertSame('Mo.', PdfDates::weekdayShort(1, 'de'));
        self::assertSame('Su', PdfDates::weekdayShort(0, 'en'));
        self::assertSame('Sa', PdfDates::weekdayShort(6, 'en'));
    }

    public function testInvalidWeekdayIsRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        PdfDates::weekdayShort(7, 'en');
    }

    public function testFormatDateAndTime(): void
    {
        $at = new \DateTimeImmutable('2026-10-27 19:30:00', new \DateTimeZone('Europe/Berlin'));

        self::assertSame('27.10.2026', PdfDates::formatDate($at, 'de'));
        self::assertSame('19:30', PdfDates::formatTime($at, 'de'));
        self::assertStringContainsString('Oct', PdfDates::formatDate($at, 'en'));
    }
}
