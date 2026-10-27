<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Locale-aware date labels for the PDF export, built on ext-intl. Weekdays use 0 = Sunday … 6 = Saturday.
 */
final class PdfDates
{
    /** A Sunday (2024-01-07), the anchor for weekday names. */
    private const string WEEKDAY_ANCHOR = '2024-01-07';

    public static function monthName(int $year, int $month, string $locale): string
    {
        if ($month < 1 || $month > 12) {
            throw new \InvalidArgumentException(sprintf('Invalid month %d.', $month));
        }

        $date = new \DateTimeImmutable(sprintf('%04d-%02d-01 12:00:00', $year, $month), new \DateTimeZone('UTC'));

        return self::format(self::formatter($locale, 'LLLL', \IntlDateFormatter::NONE, \IntlDateFormatter::NONE, 'UTC'), $date);
    }

    public static function weekdayShort(int $dayOfWeek, string $locale): string
    {
        if ($dayOfWeek < 0 || $dayOfWeek > 6) {
            throw new \InvalidArgumentException(sprintf('Invalid weekday %d.', $dayOfWeek));
        }

        $date = (new \DateTimeImmutable(self::WEEKDAY_ANCHOR.' 12:00:00', new \DateTimeZone('UTC')))->modify(sprintf('+%d days', $dayOfWeek));

        return self::format(self::formatter($locale, 'EEEEEE', \IntlDateFormatter::NONE, \IntlDateFormatter::NONE, 'UTC'), $date);
    }

    /**
     * Column order of the week grid: Sunday first only for 0, Monday first for every other value (or null).
     *
     * @return list<int>
     */
    public static function weekdayOrder(?int $firstDayOfWeek): array
    {
        return 0 === $firstDayOfWeek ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    }

    public static function formatDate(\DateTimeInterface $date, string $locale): string
    {
        $timeZone = $date->getTimezone()?->getName() ?? 'UTC';

        return self::format(self::formatter($locale, null, \IntlDateFormatter::MEDIUM, \IntlDateFormatter::NONE, $timeZone), $date);
    }

    public static function formatTime(\DateTimeInterface $time, string $locale): string
    {
        $timeZone = $time->getTimezone()?->getName() ?? 'UTC';

        return self::format(self::formatter($locale, null, \IntlDateFormatter::NONE, \IntlDateFormatter::SHORT, $timeZone), $time);
    }

    private static function formatter(string $locale, ?string $pattern, int $dateType, int $timeType, string $timeZone): \IntlDateFormatter
    {
        return new \IntlDateFormatter($locale, $dateType, $timeType, $timeZone, \IntlDateFormatter::GREGORIAN, $pattern);
    }

    private static function format(\IntlDateFormatter $formatter, \DateTimeInterface $date): string
    {
        $result = $formatter->format($date);
        if (false === $result) {
            throw new \RuntimeException('IntlDateFormatter failed: '.$formatter->getErrorMessage());
        }

        return $result;
    }
}
