<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Builds the month pages of the month-grid layout: one entry per month touched by from..to, each with weeks of
 * seven cells in the user's weekday order. Days outside from..to stay greyed and without events. Each event is one line in the
 * quarter layout's format (`time emoji title (features)`), cut by estimated width to the cell (`PdfEventLine`).
 */
final class PdfMonthGrid
{
    public const int CELL_CAP = 4;
    public const float FONT_PT = 6.5;
    /** Horizontal space of a cell that is not text: cell padding (2 x 2 pt), event left padding (2 pt) and borders. */
    private const float CELL_INSET_PT = 7.0;

    /**
     * @param list<array<string, mixed>> $entries per-day entries (key "day" = \DateTimeImmutable), sorted
     *
     * @return list<array{year: int, month: int, label: string, weeks: list<list<array<string, mixed>|null>>}>
     */
    public static function build(\DateTimeImmutable $from, \DateTimeImmutable $to, ?int $firstDayOfWeek, array $entries, string $locale, int $cap = self::CELL_CAP, float $contentWidthPt = 527.0): array
    {
        $cellEm = ($contentWidthPt / 7 - self::CELL_INSET_PT) / self::FONT_PT;
        $byDay = [];
        foreach ($entries as $entry) {
            /** @var \DateTimeImmutable $day */
            $day = $entry['day'];
            $byDay[$day->format('Y-m-d')][] = $entry;
        }

        $order = PdfDates::weekdayOrder($firstDayOfWeek);
        $fromYmd = $from->format('Y-m-d');
        $toYmd = $to->format('Y-m-d');
        $months = [];
        $cursor = new \DateTimeImmutable($from->format('Y-m-01'));
        $lastMonth = new \DateTimeImmutable($to->format('Y-m-01'));

        for (; $cursor <= $lastMonth; $cursor = $cursor->modify('+1 month')) {
            $year = (int) $cursor->format('Y');
            $month = (int) $cursor->format('n');
            $daysInMonth = (int) $cursor->format('t');
            $offset = array_search((int) $cursor->format('w'), $order, true);
            $cells = array_fill(0, $offset, null);

            for ($d = 1; $d <= $daysInMonth; ++$d) {
                $ymd = sprintf('%04d-%02d-%02d', $year, $month, $d);
                $inRange = $ymd >= $fromYmd && $ymd <= $toYmd;
                $dayEvents = $inRange ? ($byDay[$ymd] ?? []) : [];
                $shown = array_slice($dayEvents, 0, $cap);
                $cells[] = [
                    'date' => $ymd,
                    'inRange' => $inRange,
                    'number' => $d,
                    'weekend' => PdfDates::isWeekend($ymd),
                    'events' => array_map(static fn (array $e): array => self::line($e, $cellEm), $shown),
                    'more' => max(0, count($dayEvents) - $cap),
                ];
            }
            while (0 !== count($cells) % 7) {
                $cells[] = null;
            }

            $months[] = [
                'year' => $year,
                'month' => $month,
                'label' => PdfDates::monthName($year, $month, $locale).' '.$year,
                'weeks' => array_chunk($cells, 7),
            ];
        }

        return $months;
    }

    /**
     * @param array<string, mixed> $e per-day entry
     *
     * @return array{id: string, time: ?string, emojiPaths: list<string>, title: string, features: list<string>, draft: bool, text: string}
     */
    private static function line(array $e, float $cellEm): array
    {
        $event = [
            'id' => (string) ($e['id'] ?? ''),
            'time' => !($e['allDay'] ?? true) && null !== ($e['begin'] ?? null) ? (string) $e['begin'] : null,
            'emojiPaths' => $e['emojiPaths'] ?? [],
            'title' => (string) $e['name'],
            'features' => $e['features'] ?? [],
            'draft' => (bool) ($e['draft'] ?? false),
        ];

        return $event + ['text' => PdfEventLine::text($event, $cellEm, self::FONT_PT)];
    }

    /**
     * @return list<string> short weekday names in column order
     */
    public static function weekdayHeader(?int $firstDayOfWeek, string $locale): array
    {
        return array_map(static fn (int $w): string => PdfDates::weekdayShort($w, $locale), PdfDates::weekdayOrder($firstDayOfWeek));
    }
}
