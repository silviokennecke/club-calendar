<?php

declare(strict_types=1);

namespace App\Service;

use App\Exception\ApiProblemException;

/**
 * Checks for values of decoded JSON bodies, so that wrong or missing user input ends in a 4xx
 * response instead of a TypeError/500 further down (entity setters are strictly typed).
 * Errors carry `code: validation_failed` and the input `field` (RFC 7807 body, see ApiProblemException).
 *
 * Status convention: a malformed input value (missing, wrong type, format, range, time zone, half a pair)
 * is 400 on every route checked here. 422 `validation_failed` comes from DTO constraints (routes that map
 * the body onto a DTO) and from values that are well-formed but conflict with stored state (e.g. a series
 * without events).
 */
final class Input
{
    public const CODE = 'validation_failed';

    /** 400 (or another 4xx) validation error for one input field. */
    public static function invalid(string $field, string $message, int $status = 400): ApiProblemException
    {
        return new ApiProblemException($status, $message, self::CODE, $field);
    }

    /** Required non-empty string. */
    public static function string(array $data, string $key, int $maxLength = 255): string
    {
        $value = $data[$key] ?? null;
        if (!is_string($value) || '' === trim($value)) {
            throw self::invalid($key, sprintf('%s is required', $key));
        }
        if (mb_strlen($value) > $maxLength) {
            throw self::invalid($key, sprintf('%s must not be longer than %d characters', $key, $maxLength));
        }

        return $value;
    }

    /** Optional string (null allowed). */
    public static function nullableString(array $data, string $key, int $maxLength = 255): ?string
    {
        $value = $data[$key] ?? null;
        if (null === $value) {
            return null;
        }
        if (!is_string($value)) {
            throw self::invalid($key, sprintf('%s must be a string', $key));
        }
        if (mb_strlen($value) > $maxLength) {
            throw self::invalid($key, sprintf('%s must not be longer than %d characters', $key, $maxLength));
        }

        return $value;
    }

    public static function bool(array $data, string $key): bool
    {
        if (!is_bool($data[$key] ?? null)) {
            throw self::invalid($key, sprintf('%s must be a boolean', $key));
        }

        return $data[$key];
    }

    /** Required calendar date (YYYY-MM-DD). */
    public static function date(array $data, string $key): \DateTimeImmutable
    {
        $value = $data[$key] ?? null;
        if (!is_string($value)) {
            throw self::invalid($key, sprintf('%s is required (YYYY-MM-DD)', $key));
        }

        return self::parseDate($value, $key);
    }

    /**
     * Optional calendar date of a query parameter (absent or "" = none). Strictly YYYY-MM-DD and a real
     * day ("2026-02-31", "now", "tomorrow", arrays → 400 with the field), never strtotime().
     */
    public static function optionalDate(mixed $value, string $key): ?\DateTimeImmutable
    {
        if (null === $value || '' === $value) {
            return null;
        }

        return self::parseDate($value, $key);
    }

    /** A day range: `to` before `from` is a 400 on `to`. */
    public static function assertDateRange(?\DateTimeImmutable $from, ?\DateTimeImmutable $to): void
    {
        if (null !== $from && null !== $to && $to < $from) {
            throw self::invalid('to', 'to must not be before from');
        }
    }

    /** A day range of at most `$maxDays` days (both ends given): a longer one is a 400 on `to`. */
    public static function assertMaxRange(?\DateTimeImmutable $from, ?\DateTimeImmutable $to, int $maxDays): void
    {
        if (null !== $from && null !== $to && $from->diff($to)->days > $maxDays) {
            throw self::invalid('to', sprintf('The range from..to must not be longer than %d days', $maxDays));
        }
    }

    /** Optional integer query parameter within `[$min, $max]` (absent or "" = null), else 400 with the field. */
    public static function optionalInt(mixed $value, string $key, int $min, int $max): ?int
    {
        if (null === $value || '' === $value) {
            return null;
        }
        if (!is_string($value) || !preg_match('/^\d{1,10}$/', $value) || (int) $value < $min || (int) $value > $max) {
            throw self::invalid($key, sprintf('%s must be an integer between %d and %d', $key, $min, $max));
        }

        return (int) $value;
    }

    public static function parseDate(mixed $value, string $key): \DateTimeImmutable
    {
        $date = is_string($value) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $value) : false;
        if (false === $date || $date->format('Y-m-d') !== $value) {
            throw self::invalid($key, sprintf('Invalid %s (expected YYYY-MM-DD)', $key));
        }

        return $date;
    }

    /** Required time of day "HH:MM" (seconds are accepted and dropped; the column holds HH:MM). */
    public static function time(array $data, string $key): string
    {
        $value = $data[$key] ?? null;
        if (!is_string($value) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $value)) {
            throw self::invalid($key, sprintf('%s is required (HH:MM)', $key));
        }

        return substr($value, 0, 5);
    }

    /** Optional time of day "HH:MM" (null or "" = no time). */
    public static function nullableTime(array $data, string $key): ?string
    {
        $value = $data[$key] ?? null;
        if (null === $value || '' === $value) {
            return null;
        }

        return self::time($data, $key);
    }

    /** Most ids in one list field (properties, features, target groups of an event, template or feed). */
    public const MAX_IDS = 500;

    /**
     * @return list<string>
     */
    public static function idList(array $data, string $key): array
    {
        $value = $data[$key] ?? [];
        if (null === $value) {
            return [];
        }
        if (!is_array($value)) {
            throw self::invalid($key, sprintf('%s must be a list of ids', $key));
        }
        foreach ($value as $id) {
            if (!is_string($id) && !is_int($id)) {
                throw self::invalid($key, sprintf('%s must be a list of ids', $key));
            }
        }

        $ids = array_values(array_unique(array_map('strval', $value)));
        if (count($ids) > self::MAX_IDS) {
            throw self::invalid($key, sprintf('%s must not have more than %d distinct ids', $key, self::MAX_IDS));
        }

        return $ids;
    }

    /** Optional IANA time zone (null allowed); anything else would break the ICS feed later. */
    public static function timezone(array $data, string $key, bool $nullable = true): ?string
    {
        $value = $data[$key] ?? null;
        if (null === $value) {
            if ($nullable) {
                return null;
            }
            throw self::invalid($key, sprintf('%s is required', $key));
        }
        $canonical = is_string($value) ? self::canonicalTimezone($value) : null;
        if (null === $canonical) {
            throw self::invalid($key, sprintf('%s must be a valid IANA time zone (e.g. Europe/Berlin)', $key));
        }

        return $canonical;
    }

    public static function isValidTimezone(?string $timezone): bool
    {
        return null !== self::canonicalTimezone($timezone);
    }

    /**
     * The listed spelling of an IANA zone name, matched case-insensitively like PHP's DateTimeZone
     * does ("europe/berlin" -> "Europe/Berlin"); null if unknown.
     */
    public static function canonicalTimezone(?string $timezone): ?string
    {
        static $byLowerName = null;
        if (null === $timezone || '' === $timezone) {
            return null;
        }
        if (null === $byLowerName) {
            $identifiers = \DateTimeZone::listIdentifiers(\DateTimeZone::ALL_WITH_BC);
            $byLowerName = array_combine(array_map(strtolower(...), $identifiers), $identifiers);
        }

        return $byLowerName[strtolower($timezone)] ?? null;
    }
}
