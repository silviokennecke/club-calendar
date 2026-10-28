<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Pages of the quarter-overview layout: the months touched by from..to in chunks of three (the last page holds the
 * remaining one or two). Each month is one column with one row per calendar day, each event one line.
 *
 * All sizes are computed here and handed to the template as numbers: the font size scales per page so that the
 * fullest of the page's months fits the page height (same scale for every column of a page). If even the minimum
 * font cannot fit, the content flows onto a second page instead of clipping events.
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
    private const float SAFETY = 0.94;
    private const float EMOJI_EM = 1.1;
    private const float DEFAULT_EM = 0.62;
    private const float UPPER_EM = 0.72;
    private const float DIGIT_EM = 0.64;
    /** Advance widths (em) of DejaVu Sans glyphs that differ much from the lower/upper/digit defaults. */
    private const array EM = [
        ' ' => 0.32, 'i' => 0.28, 'j' => 0.28, 'l' => 0.28, 'f' => 0.35, 't' => 0.39, 'r' => 0.41, 'I' => 0.3, 'J' => 0.3,
        '.' => 0.32, ',' => 0.32, ':' => 0.34, ';' => 0.34, '(' => 0.39, ')' => 0.39, '/' => 0.34, '-' => 0.36, '|' => 0.34,
        'm' => 0.97, 'w' => 0.82, 'M' => 0.86, 'W' => 0.99, 's' => 0.52, 'c' => 0.55, 'z' => 0.53, 'L' => 0.56,
    ];

    /**
     * @param list<array<string, mixed>> $entries         per-day entries (key "day" = \DateTimeImmutable), sorted
     * @param float                      $contentHeightPt printable page height in points
     * @param float                      $contentWidthPt  printable page width in points
     *
     * @return list<array{months: list<array{label: string, rows: list<array<string, mixed>>}>, fontPt: float, lineHeightPt: float, rowHeightPt: float, emojiPt: float, eventIds: list<string>}>
     */
    public static function build(\DateTimeImmutable $from, \DateTimeImmutable $to, array $entries, string $locale, float $contentHeightPt, float $contentWidthPt): array
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
            $months[] = self::month($cursor, $from->format('Y-m-d'), $to->format('Y-m-d'), $byDay, $locale);
        }

        $pages = [];
        foreach (array_chunk($months, self::MONTHS_PER_PAGE) as $chunk) {
            $maxLines = max(array_column($chunk, 'lines'));
            $font = self::fontFor($maxLines, $contentHeightPt);
            $lineHeight = round($font * self::LINE_FACTOR, 2);
            $ids = [];
            $textWidthEm = ($contentWidthPt * self::COLUMN_SHARE * self::EVENT_CELL_SHARE - self::CELL_PADDING_PT) / $font;
            foreach ($chunk as &$month) {
                foreach ($month['rows'] as &$row) {
                    foreach ($row['events'] ?? [] as $i => $event) {
                        $row['events'][$i]['text'] = self::lineText($event, $textWidthEm, $font);
                    }
                }
                unset($row);
                if ($month['lines'] < $maxLines) {
                    $month['rows'][] = ['kind' => 'grey', 'lines' => $maxLines - $month['lines']];
                }
                foreach ($month['ids'] as $id) {
                    $ids[$id] = $id;
                }
            }
            unset($month);

            $pages[] = [
                'months' => array_map(static fn (array $m): array => ['label' => $m['label'], 'rows' => $m['rows']], $chunk),
                'fontPt' => $font,
                'lineHeightPt' => $lineHeight,
                'rowHeightPt' => round(self::MIN_DAY_LINES * $lineHeight, 2),
                'emojiPt' => round($font * 1.1, 2),
                'eventIds' => array_values($ids),
            ];
        }

        return $pages;
    }

    /** Font size in points for a page whose fullest column has $lines lines; line height is proportional. */
    public static function fontFor(int $lines, float $contentHeightPt): float
    {
        $perLine = ($contentHeightPt - self::FIXED_HEIGHT_PT - (self::GRID_DAYS + 1) * self::ROW_BORDER_PT) / max(1, $lines) / self::LINE_FACTOR;

        return round(min(self::MAX_FONT_PT, max(self::MIN_FONT_PT, $perLine)), 2);
    }

    /**
     * "Title (features)" cut with an ellipsis so that time, emoji and text fit one line of the event cell.
     *
     * @param array<string, mixed> $event
     */
    private static function lineText(array $event, float $cellEm, float $font): string
    {
        $text = (string) $event['title'];
        if ([] !== $event['features']) {
            $text .= ' ('.implode(', ', $event['features']).')';
        }
        $prefix = 0.0;
        if (null !== $event['time']) {
            $prefix += self::emWidth((string) $event['time']) + self::EM[' '];
        }
        $prefix += count($event['emojiPaths']) * (self::EMOJI_EM + 1.0 / $font) + ([] !== $event['emojiPaths'] ? self::EM[' '] : 0.0);
        $budget = ($cellEm - $prefix) * self::SAFETY;
        if (self::emWidth($text) <= $budget) {
            return $text;
        }

        $room = $budget - self::emWidth('…');
        $out = '';
        $used = 0.0;
        foreach (mb_str_split($text) as $char) {
            $used += self::emWidth($char);
            if ($used > $room) {
                break;
            }
            $out .= $char;
        }

        return rtrim($out).'…';
    }

    private static function emWidth(string $text): float
    {
        $sum = 0.0;
        foreach (mb_str_split($text) as $char) {
            $sum += self::EM[$char] ?? (1 === preg_match('/\p{Lu}/u', $char) ? self::UPPER_EM : (1 === preg_match('/\d/', $char) ? self::DIGIT_EM : self::DEFAULT_EM));
        }

        return $sum;
    }

    /**
     * @param array<string, list<array<string, mixed>>> $byDay
     *
     * @return array{label: string, rows: list<array<string, mixed>>, lines: int, ids: list<string>}
     */
    private static function month(\DateTimeImmutable $first, string $fromYmd, string $toYmd, array $byDay, string $locale): array
    {
        $year = (int) $first->format('Y');
        $month = (int) $first->format('n');
        $daysInMonth = (int) $first->format('t');
        $rows = [];
        $lines = 0;
        $ids = [];

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
                    'time' => !$entry['allDay'] && null !== ($entry['begin'] ?? null) ? $entry['begin'] : null,
                    'emojiPaths' => $entry['emojiPaths'] ?? [],
                    'title' => (string) $entry['name'],
                    'features' => $entry['features'] ?? [],
                    'draft' => (bool) ($entry['draft'] ?? false),
                ];
                if ([] !== ($entry['emojiPaths'] ?? [])) {
                    $ids[(string) $entry['id']] = (string) $entry['id'];
                }
            }
            $rowLines = max(self::MIN_DAY_LINES, count($events));
            $lines += $rowLines;
            $rows[] = [
                'kind' => 'day',
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
            'ids' => array_values($ids),
        ];
    }
}
