<?php

declare(strict_types=1);

namespace App\Security;

/** Client-derived text ends up in log rows and notification mails, so only inert characters survive. */
final class ClientContextSanitizer
{
    public const int BROWSER_MAX = 20;
    public const int CITY_MAX = 100;
    public const int USER_AGENT_MAX = 512;

    /** uap family (lower case) => name shown in notices. Anything else is "unknown" (null). */
    private const array KNOWN_BROWSERS = [
        'chrome' => 'Chrome',
        'chrome mobile' => 'Chrome Mobile',
        'chrome mobile ios' => 'Chrome Mobile',
        'chromium' => 'Chromium',
        'firefox' => 'Firefox',
        'firefox mobile' => 'Firefox Mobile',
        'firefox ios' => 'Firefox iOS',
        'safari' => 'Safari',
        'mobile safari' => 'Mobile Safari',
        'mobile safari ui/wkwebview' => 'Mobile Safari',
        'edge' => 'Edge',
        'edge mobile' => 'Edge Mobile',
        'opera' => 'Opera',
        'opera mobile' => 'Opera Mobile',
        'opera mini' => 'Opera Mini',
        'samsung internet' => 'Samsung Internet',
        'brave' => 'Brave',
        'vivaldi' => 'Vivaldi',
        'duckduckgo mobile' => 'DuckDuckGo',
        'duckduckgo' => 'DuckDuckGo',
        'android' => 'Android Browser',
        'android browser' => 'Android Browser',
        'ie' => 'IE',
        'ie mobile' => 'IE Mobile',
    ];

    /** Known browser name plus optional major version (1-3 digits); null for everything else. */
    public static function knownBrowser(?string $family, ?string $major = null): ?string
    {
        if (null === $family) {
            return null;
        }
        $name = self::KNOWN_BROWSERS[strtolower(trim($family))] ?? null;
        if (null === $name) {
            return null;
        }

        return null !== $major && 1 === preg_match('/^\d{1,3}$/', $major) ? $name.' '.$major : $name;
    }

    /** Re-validates an already summarised "Name 126" against the allow-list (the single gate for stored and mailed browsers). */
    public static function browser(string $value): ?string
    {
        if (1 !== preg_match('/^([A-Za-z ]{1,30}?)(?: (\d{1,3}))?$/', $value, $m)) {
            return null;
        }

        return self::knownBrowser($m[1], $m[2] ?? null);
    }

    /** Raw User-Agent for the log only: valid UTF-8, no control characters, at most 512 characters. */
    public static function userAgent(?string $value): ?string
    {
        if (null === $value) {
            return null;
        }
        $clean = (string) preg_replace('/[\x00-\x1F\x7F]+/', ' ', mb_convert_encoding($value, 'UTF-8', 'UTF-8'));
        $clean = mb_substr(trim($clean), 0, self::USER_AGENT_MAX);

        return '' === $clean ? null : $clean;
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
