<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * The twelve compact month tables of the annual-overview layout (days with events are flagged) and the
 * chronological event list that follows them.
 */
final class PdfAnnualOverview
{
    /**
     * @param list<array<string, mixed>>                        $entries  per-day entries (key "day" = \DateTimeImmutable), sorted
     * @param array<string, array{kind: string, name: ?string}> $holidays see PdfHolidays::days()
     *
     * @return list<array{month: int, label: string, weeks: list<list<array{number: int, hasEvents: bool, weekend: bool, shade: string}|null>>}>
     */
    public static function build(int $year, ?int $firstDayOfWeek, array $entries, string $locale, array $holidays = []): array
    {
        $withEvents = [];
        foreach ($entries as $entry) {
            /** @var \DateTimeImmutable $day */
            $day = $entry['day'];
            $withEvents[$day->format('Y-m-d')] = true;
        }

        $order = PdfDates::weekdayOrder($firstDayOfWeek);
        $months = [];
        for ($month = 1; $month <= 12; ++$month) {
            $first = new \DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month));
            $cells = array_fill(0, (int) array_search((int) $first->format('w'), $order, true), null);
            for ($d = 1, $n = (int) $first->format('t'); $d <= $n; ++$d) {
                $ymd = sprintf('%04d-%02d-%02d', $year, $month, $d);
                $cells[] = ['number' => $d, 'hasEvents' => isset($withEvents[$ymd]), 'weekend' => PdfDates::isWeekend($ymd), 'shade' => PdfHolidays::shade($holidays[$ymd] ?? null, PdfDates::isWeekend($ymd))];
            }
            while (0 !== count($cells) % 7) {
                $cells[] = null;
            }
            $months[] = [
                'month' => $month,
                'label' => PdfDates::monthName($year, $month, $locale),
                'weeks' => array_chunk($cells, 7),
            ];
        }

        return $months;
    }

    /**
     * @param list<array<string, mixed>> $entries sorted per-day entries
     *
     * @return list<array<string, mixed>> the entries with a "dateLabel" (short weekday and date)
     */
    public static function eventList(array $entries, string $locale): array
    {
        return array_map(static function (array $entry) use ($locale): array {
            /** @var \DateTimeImmutable $day */
            $day = $entry['day'];

            return $entry + ['dateLabel' => PdfDates::weekdayShort((int) $day->format('w'), $locale).', '.PdfDates::formatDate($day, $locale), 'weekend' => PdfDates::isWeekend($day->format('Y-m-d'))];
        }, $entries);
    }
}
