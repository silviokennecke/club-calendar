<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Pages of the quarter-overview layout: the months touched by from..to in chunks of three (the last page holds the
 * remaining one or two). Each month is one column with one row per calendar day, each event one line.
 *
 * All sizes are computed here and handed to the template as numbers: the font size scales per page so that the
 * fullest of the page's months fits the page height (same scale for every column of a page). If even the minimum
 * font cannot fit, the months continue on further pages (cut at day boundaries): dompdf cannot split the nested month
 * tables, it would push the whole table to the next page and leave the first one empty.
 */
final class PdfQuarterOverview
{
    public const int MONTHS_PER_PAGE = 3;
    public const float MIN_FONT_PT = 4.5;
    public const float MAX_FONT_PT = 8.0;

    private const int MIN_DAY_LINES = 2;
    private const int GRID_DAYS = 31;
    private const float LINE_FACTOR = 1.15;
    /** Header, month bar, legend (one line), gaps and row borders that do not scale with the font. */
    private const float FIXED_HEIGHT_PT = 62.0;
    private const float ROW_BORDER_PT = 0.5;
    /** Column width and event cell width as in the template; text is cut by estimated width because dompdf wraps lines with inline images despite nowrap. */
    private const float COLUMN_SHARE = 0.32;
    private const float EVENT_CELL_SHARE = 0.79;
    private const float CELL_PADDING_PT = 4.0;

    /**
     * @param list<array<string, mixed>> $entries         per-day entries (key "day" = \DateTimeImmutable), sorted
     * @param float                      $contentHeightPt printable page height in points
     * @param float                      $contentWidthPt  printable page width in points
     *
     * @return list<array{months: list<array{label: string, rows: list<array<string, mixed>>}>, fontPt: float, lineHeightPt: float, rowHeightPt: float, emojiPt: float, eventIds: list<string>, holidayKinds: list<string>}>
     */
    public static function build(\DateTimeImmutable $from, \DateTimeImmutable $to, array $entries, string $locale, float $contentHeightPt, float $contentWidthPt, array $holidays = []): array
    {
        $byDay = [];
        foreach ($entries as $entry) {
            /** @var \DateTimeImmutable $day */
            $day = $entry['day'];
            $byDay[$day->format('Y-m-d')][] = $entry;
        }

        $months = [];
        $cursor = new \DateTimeImmutable($from->format('Y-m-01'));
        $lastMonth = new \DateTimeImmutable($to->format('Y-m-01'));
        for (; $cursor <= $lastMonth; $cursor = $cursor->modify('+1 month')) {
            $months[] = self::month($cursor, $from->format('Y-m-d'), $to->format('Y-m-d'), $byDay, $locale, $holidays);
        }

        $capacity = self::capacity($contentHeightPt);
        $pages = [];
        foreach (array_chunk($months, self::MONTHS_PER_PAGE) as $chunk) {
            $segments = array_map(static fn (array $m): array => self::segments($m['rows'], $capacity), $chunk);
            for ($s = 0, $count = max(array_map('count', $segments)); $s < $count; ++$s) {
                $pageMonths = [];
                foreach ($chunk as $i => $month) {
                    $seg = $segments[$i][$s] ?? ['rows' => [], 'lines' => 0];
                    $pageMonths[] = ['label' => $month['label'], 'rows' => $seg['rows'], 'lines' => $seg['lines']];
                }
                $pages[] = self::page($pageMonths, $contentHeightPt, $contentWidthPt);
            }
        }

        return $pages;
    }

    /**
     * @param list<array{label: string, rows: list<array<string, mixed>>, lines: int}> $months
     *
     * @return array{months: list<array{label: string, rows: list<array<string, mixed>>}>, fontPt: float, lineHeightPt: float, rowHeightPt: float, emojiPt: float, eventIds: list<string>, holidayKinds: list<string>}
     */
    private static function page(array $months, float $contentHeightPt, float $contentWidthPt): array
    {
        $maxLines = max(array_column($months, 'lines'));
        $font = self::fontFor($maxLines, $contentHeightPt);
        $lineHeight = round($font * self::LINE_FACTOR, 2);
        $ids = [];
        $kinds = [];
        $textWidthEm = ($contentWidthPt * self::COLUMN_SHARE * self::EVENT_CELL_SHARE - self::CELL_PADDING_PT) / $font;
        foreach ($months as &$month) {
            foreach ($month['rows'] as &$row) {
                if (in_array($row['shade'] ?? null, [PdfHolidays::PUBLIC, PdfHolidays::SCHOOL], true)) {
                    $kinds[$row['shade']] = true;
                }
                if (null !== ($row['holidayName'] ?? null)) {
                    $row['holidayText'] = PdfEventLine::text(['time' => null, 'emojiPaths' => [], 'title' => $row['holidayName'], 'features' => []], $textWidthEm, $font);
                }
                foreach ($row['events'] ?? [] as $i => $event) {
                    $row['events'][$i]['text'] = PdfEventLine::text($event, $textWidthEm, $font);
                    if ([] !== $event['emojiPaths']) {
                        $ids[(string) $event['id']] = (string) $event['id'];
                    }
                }
            }
            unset($row);
            if ($month['lines'] < $maxLines) {
                $month['rows'][] = ['kind' => 'grey', 'lines' => $maxLines - $month['lines']];
            }
        }
        unset($month);

        return [
            'months' => array_map(static fn (array $m): array => ['label' => $m['label'], 'rows' => $m['rows']], $months),
            'fontPt' => $font,
            'lineHeightPt' => $lineHeight,
            'rowHeightPt' => round(self::MIN_DAY_LINES * $lineHeight, 2),
            'emojiPt' => round($font * 1.1, 2),
            'eventIds' => array_values($ids),
            'holidayKinds' => array_values(array_filter([PdfHolidays::PUBLIC, PdfHolidays::SCHOOL], static fn (string $k): bool => isset($kinds[$k]))),
        ];
    }

    /** Lines that fit one column at the minimum font. */
    private static function capacity(float $contentHeightPt): int
    {
        $lines = (int) floor(($contentHeightPt - self::FIXED_HEIGHT_PT - (self::GRID_DAYS + 1) * self::ROW_BORDER_PT) / (self::MIN_FONT_PT * self::LINE_FACTOR));

        return max(self::MIN_DAY_LINES + 1, $lines);
    }

    /**
     * Rows cut at day boundaries into pieces of at most $capacity lines.
     *
     * @param list<array<string, mixed>> $rows
     *
     * @return list<array{rows: list<array<string, mixed>>, lines: int}>
     */
    private static function segments(array $rows, int $capacity): array
    {
        $segments = [];
        $current = ['rows' => [], 'lines' => 0];
        foreach ($rows as $row) {
            if ($row['lines'] > $capacity) {
                $hidden = count($row['events']) - ($capacity - 1);
                $row['events'] = array_slice($row['events'], 0, $capacity - 1);
                $row['events'][] = ['id' => '', 'time' => null, 'emojiPaths' => [], 'title' => '… +'.$hidden, 'features' => [], 'draft' => false];
                $row['lines'] = $capacity;
            }
            if ([] !== $current['rows'] && $current['lines'] + $row['lines'] > $capacity) {
                $segments[] = $current;
                $current = ['rows' => [], 'lines' => 0];
            }
            $current['rows'][] = $row;
            $current['lines'] += $row['lines'];
        }
        $segments[] = $current;

        return $segments;
    }

    /** Font size in points for a page whose fullest column has $lines lines; line height is proportional. */
    public static function fontFor(int $lines, float $contentHeightPt): float
    {
        $perLine = ($contentHeightPt - self::FIXED_HEIGHT_PT - (self::GRID_DAYS + 1) * self::ROW_BORDER_PT) / max(1, $lines) / self::LINE_FACTOR;

        return round(min(self::MAX_FONT_PT, max(self::MIN_FONT_PT, $perLine)), 2);
    }

    /**
     * @param array<string, list<array<string, mixed>>> $byDay
     *
     * @return array{label: string, rows: list<array<string, mixed>>, lines: int}
     */
    private static function month(\DateTimeImmutable $first, string $fromYmd, string $toYmd, array $byDay, string $locale, array $holidays = []): array
    {
        $year = (int) $first->format('Y');
        $month = (int) $first->format('n');
        $daysInMonth = (int) $first->format('t');
        $rows = [];
        $lines = 0;

        for ($d = 1; $d <= self::GRID_DAYS; ++$d) {
            if ($d > $daysInMonth) {
                $rows[] = ['kind' => 'grey', 'lines' => self::MIN_DAY_LINES];
                $lines += self::MIN_DAY_LINES;
                continue;
            }
            $ymd = sprintf('%04d-%02d-%02d', $year, $month, $d);
            if ($ymd < $fromYmd || $ymd > $toYmd) {
                $rows[] = ['kind' => 'grey', 'lines' => self::MIN_DAY_LINES];
                $lines += self::MIN_DAY_LINES;
                continue;
            }

            $weekday = (int) (new \DateTimeImmutable($ymd))->format('w');
            $events = [];
            foreach ($byDay[$ymd] ?? [] as $entry) {
                $events[] = [
                    'id' => (string) $entry['id'],
                    'time' => !$entry['allDay'] && null !== ($entry['begin'] ?? null) ? $entry['begin'] : null,
                    'emojiPaths' => $entry['emojiPaths'] ?? [],
                    'title' => (string) $entry['name'],
                    'features' => $entry['features'] ?? [],
                    'draft' => (bool) ($entry['draft'] ?? false),
                ];
            }
            $rowLines = max(self::MIN_DAY_LINES, count($events));
            $lines += $rowLines;
            $holiday = $holidays[$ymd] ?? null;
            $weekend = 0 === $weekday || 6 === $weekday;
            $rows[] = [
                'kind' => 'day',
                'shade' => PdfHolidays::shade($holiday, $weekend),
                // the name takes a free line only: the font scaling counts lines, so it never adds one
                'holidayName' => count($events) < self::MIN_DAY_LINES ? ($holiday['name'] ?? null) : null,
                'number' => $d,
                'weekday' => PdfDates::weekdayShort($weekday, $locale),
                'weekend' => 0 === $weekday || 6 === $weekday,
                'events' => $events,
                'lines' => $rowLines,
            ];
        }

        return [
            'label' => PdfDates::monthName($year, $month, $locale).' '.$year,
            'rows' => $rows,
            'lines' => $lines,
        ];
    }
}
