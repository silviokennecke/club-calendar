<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;

/**
 * Checks for values of decoded JSON bodies, so that wrong or missing user input ends in a 4xx
 * response instead of a TypeError/500 further down (entity setters are strictly typed).
 */
final class Input
{
    /** Required non-empty string. */
    public static function string(array $data, string $key, int $maxLength = 255): string
    {
        $value = $data[$key] ?? null;
        if (!is_string($value) || '' === trim($value)) {
            throw new BadRequestHttpException(sprintf('%s is required', $key));
        }
        if (mb_strlen($value) > $maxLength) {
            throw new BadRequestHttpException(sprintf('%s must not be longer than %d characters', $key, $maxLength));
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
            throw new BadRequestHttpException(sprintf('%s must be a string', $key));
        }
        if (mb_strlen($value) > $maxLength) {
            throw new BadRequestHttpException(sprintf('%s must not be longer than %d characters', $key, $maxLength));
        }

        return $value;
    }

    public static function bool(array $data, string $key): bool
    {
        if (!is_bool($data[$key] ?? null)) {
            throw new BadRequestHttpException(sprintf('%s must be a boolean', $key));
        }

        return $data[$key];
    }

    /** Required calendar date (YYYY-MM-DD). */
    public static function date(array $data, string $key): \DateTimeImmutable
    {
        $value = $data[$key] ?? null;
        if (!is_string($value)) {
            throw new BadRequestHttpException(sprintf('%s is required (YYYY-MM-DD)', $key));
        }

        return self::parseDate($value, $key);
    }

    public static function parseDate(mixed $value, string $key): \DateTimeImmutable
    {
        $date = is_string($value) ? \DateTimeImmutable::createFromFormat('!Y-m-d', $value) : false;
        if (false === $date || $date->format('Y-m-d') !== $value) {
            throw new BadRequestHttpException(sprintf('Invalid %s (expected YYYY-MM-DD)', $key));
        }

        return $date;
    }

    /** Required time of day "HH:MM" (seconds are accepted and dropped; the column holds HH:MM). */
    public static function time(array $data, string $key): string
    {
        $value = $data[$key] ?? null;
        if (!is_string($value) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $value)) {
            throw new BadRequestHttpException(sprintf('%s is required (HH:MM)', $key));
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
            throw new BadRequestHttpException(sprintf('%s must be a list of ids', $key));
        }
        foreach ($value as $id) {
            if (!is_string($id) && !is_int($id)) {
                throw new BadRequestHttpException(sprintf('%s must be a list of ids', $key));
            }
        }

        return array_values(array_unique(array_map('strval', $value)));
    }

    /** Optional IANA time zone (null allowed); anything else would break the ICS feed later. */
    public static function timezone(array $data, string $key, bool $nullable = true): ?string
    {
        $value = $data[$key] ?? null;
        if (null === $value) {
            if ($nullable) {
                return null;
            }
            throw new BadRequestHttpException(sprintf('%s is required', $key));
        }
        $canonical = is_string($value) ? self::canonicalTimezone($value) : null;
        if (null === $canonical) {
            throw new UnprocessableEntityHttpException(sprintf('%s must be a valid IANA time zone (e.g. Europe/Berlin)', $key));
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
