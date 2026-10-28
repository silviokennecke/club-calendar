<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Per-day holiday marking of the exported period. Colour priority per day (after the grey out-of-range days):
 * public holiday, weekend, school holiday. Public holidays (type public/other) carry their name on every day,
 * school holidays only on the first visible day of a range.
 */
final class PdfHolidays
{
    public const string PUBLIC = 'pub';
    public const string SCHOOL = 'sch';
    private const int MAX_NAME = 80;

    /**
     * @param list<array{type: string, name: string, date: string, dateEnd: string}> $rows
     *
     * @return array<string, array{kind: string, name: ?string}> by Y-m-d; name is null on school days without a label
     */
    public static function days(array $rows, \DateTimeImmutable $from, \DateTimeImmutable $to): array
    {
        $fromYmd = $from->format('Y-m-d');
        $toYmd = $to->format('Y-m-d');
        $public = [];
        $school = [];
        foreach ($rows as $row) {
            $name = PdfText::truncate(PdfText::stripEmoji($row['name']), self::MAX_NAME);
            $isSchool = 'school' === $row['type'];
            $start = max($row['date'], $fromYmd);
            $end = min($row['dateEnd'], $toYmd);
            for ($d = new \DateTimeImmutable($start); $d->format('Y-m-d') <= $end; $d = $d->modify('+1 day')) {
                $ymd = $d->format('Y-m-d');
                if (!$isSchool) {
                    $public[$ymd][$name] = $name;
                } else {
                    $school[$ymd] ??= [];
                    if ($ymd === $start) {
                        $school[$ymd][$name] = $name;
                    }
                }
            }
        }

        $days = [];
        foreach ($school as $ymd => $names) {
            $days[$ymd] = ['kind' => self::SCHOOL, 'name' => [] === $names ? null : implode(', ', $names)];
        }
        foreach ($public as $ymd => $names) {
            $days[$ymd] = ['kind' => self::PUBLIC, 'name' => implode(', ', $names)];
        }

        return $days;
    }

    /** Colour class of a day: public holiday, then weekend, then school holiday. */
    public static function shade(?array $holiday, bool $weekend): string
    {
        if (null !== $holiday && self::PUBLIC === $holiday['kind']) {
            return self::PUBLIC;
        }
        if ($weekend) {
            return 'we';
        }

        return null !== $holiday ? self::SCHOOL : 'wd';
    }
}
