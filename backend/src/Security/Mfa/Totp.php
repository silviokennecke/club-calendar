<?php

declare(strict_types=1);

namespace App\Security\Mfa;

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) with RFC 4648 base32 secrets. */
final class Totp
{
    public const PERIOD = 30;
    public const DIGITS = 6;
    public const WINDOW = 1;
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function generateSecret(): string
    {
        return self::base32Encode(random_bytes(20));
    }

    public static function step(int $timestamp): int
    {
        return intdiv($timestamp, self::PERIOD);
    }

    public static function code(string $base32Secret, int $step): string
    {
        $key = self::base32Decode($base32Secret);
        $hash = hash_hmac('sha1', pack('J', $step), $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $bin = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($bin % 10 ** self::DIGITS), self::DIGITS, '0', STR_PAD_LEFT);
    }

    /**
     * Returns the matching time step, or null. Steps <= $lastUsedStep are rejected (replay protection); the caller
     * stores the returned step.
     */
    public static function verify(string $base32Secret, string $code, ?int $lastUsedStep = null, ?int $now = null): ?int
    {
        $code = preg_replace('/\s+/', '', $code) ?? '';
        if (!preg_match('/^\d{'.self::DIGITS.'}$/', $code)) {
            return null;
        }
        $current = self::step($now ?? time());
        $matched = null;
        for ($step = $current - self::WINDOW; $step <= $current + self::WINDOW; ++$step) {
            if ($step < 0) {
                continue;
            }
            // No early exit: constant work for every candidate
            if (hash_equals(self::code($base32Secret, $step), $code) && (null === $lastUsedStep || $step > $lastUsedStep)) {
                $matched = $step;
            }
        }

        return $matched;
    }

    public static function otpauthUri(string $issuer, string $account, string $base32Secret): string
    {
        return sprintf(
            'otpauth://totp/%s:%s?secret=%s&issuer=%s&algorithm=SHA1&digits=%d&period=%d',
            rawurlencode($issuer),
            rawurlencode($account),
            $base32Secret,
            rawurlencode($issuer),
            self::DIGITS,
            self::PERIOD,
        );
    }

    public static function base32Encode(string $data): string
    {
        $bits = '';
        foreach (str_split($data) as $c) {
            $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0'))];
        }

        return $out;
    }

    public static function base32Decode(string $encoded): string
    {
        $encoded = strtoupper(rtrim(str_replace(' ', '', $encoded), '='));
        $bits = '';
        foreach (str_split($encoded) as $c) {
            $pos = strpos(self::ALPHABET, $c);
            if (false === $pos) {
                throw new \InvalidArgumentException('Invalid base32 character.');
            }
            $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (8 === strlen($byte)) {
                $out .= chr((int) bindec($byte));
            }
        }

        return $out;
    }
}
