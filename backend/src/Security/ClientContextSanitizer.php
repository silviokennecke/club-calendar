<?php

declare(strict_types=1);

namespace App\Security;

/** Client-derived text ends up in log rows and notification mails, so only inert characters survive. */
final class ClientContextSanitizer
{
    public const int BROWSER_MAX = 20;
    public const int CITY_MAX = 100;

    /** Letters, digits, space, dot, hyphen, underscore (ASCII only); null when nothing is left. */
    public static function browser(string $value, int $max = self::BROWSER_MAX): ?string
    {
        return self::cut(self::collapse((string) preg_replace('/[^A-Za-z0-9 ._-]+/', '', $value)), $max);
    }

    /** "Family Major" within the limit: the family is shortened first so the version stays complete. */
    public static function browserWithVersion(string $family, ?string $major, int $max = self::BROWSER_MAX): ?string
    {
        $family = self::collapse((string) preg_replace('/[^A-Za-z0-9 ._-]+/', '', $family));
        $major = null === $major ? '' : self::collapse((string) preg_replace('/[^A-Za-z0-9._-]+/', '', $major));
        if ('' !== $major && strlen($major) + 2 <= $max) {
            $room = $max - strlen($major) - 1;
            if (strlen($family) > $room) {
                $short = substr($family, 0, $room);
                // prefer whole words: "Chrome Mobile 126" over "Chrome Mobile iO 126"
                $family = false !== ($space = strrpos($short, ' ')) && $space > 0 ? substr($short, 0, $space) : $short;
            }
            $family = rtrim($family);

            return '' === $family ? null : $family.' '.$major;
        }

        return self::cut($family, $max);
    }

    /** Unicode letters/marks/digits are kept (Zürich, São Paulo), everything else is dropped. */
    public static function city(?string $value, int $max = self::CITY_MAX): ?string
    {
        if (null === $value) {
            return null;
        }
        $clean = self::collapse((string) preg_replace("/[^\\p{L}\\p{M}\\p{N} .'-]+/u", '', $value));

        return self::cut($clean, $max, true);
    }

    public static function country(?string $value): ?string
    {
        $value = null === $value ? '' : strtoupper(trim($value));

        return 1 === preg_match('/^[A-Z]{2}$/', $value) ? $value : null;
    }

    private static function collapse(string $value): string
    {
        return trim((string) preg_replace('/ {2,}/', ' ', str_replace(["\t", "\n", "\r"], ' ', $value)));
    }

    private static function cut(string $value, int $max, bool $multibyte = false): ?string
    {
        $value = rtrim($multibyte ? mb_substr($value, 0, $max) : substr($value, 0, $max));

        return '' === $value ? null : $value;
    }
}
