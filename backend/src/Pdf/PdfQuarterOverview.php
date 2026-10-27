<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Pages of the quarter-overview layout: the months touched by from..to in chunks of three (the last page holds the
 * remaining one or two), each month a compact grid built by {@see PdfMonthGrid}.
 */
final class PdfQuarterOverview
{
    public const int MONTHS_PER_PAGE = 3;
    public const int CELL_CAP = 3;
    private const int CELL_NAME = 16;

    /**
     * @param list<array<string, mixed>> $entries per-day entries, see {@see PdfMonthGrid::build()}
     *
     * @return list<list<array{year: int, month: int, label: string, weeks: list<list<array<string, mixed>|null>>}>> months per page
     */
    public static function build(\DateTimeImmutable $from, \DateTimeImmutable $to, ?int $firstDayOfWeek, array $entries, string $locale): array
    {
        $months = PdfMonthGrid::build($from, $to, $firstDayOfWeek, $entries, $locale, self::CELL_CAP);
        foreach ($months as &$month) {
            foreach ($month['weeks'] as &$week) {
                foreach ($week as &$cell) {
                    if (null === $cell) {
                        continue;
                    }
                    foreach ($cell['events'] as &$event) {
                        $event['cellName'] = PdfText::truncate((string) $event['name'], self::CELL_NAME);
                    }
                    unset($event);
                }
                unset($cell);
            }
            unset($week);
        }
        unset($month);

        return array_chunk($months, self::MONTHS_PER_PAGE);
    }
}
