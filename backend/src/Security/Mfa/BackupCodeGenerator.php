<?php

declare(strict_types=1);

namespace App\Security\Mfa;

/** Backup codes: 12 Crockford base32 characters (60 bits), shown as xxxx-xxxx-xxxx. */
final class BackupCodeGenerator
{
    public const COUNT = 10;
    private const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    /** @return list<string> formatted codes */
    public function generate(int $count = self::COUNT): array
    {
        $codes = [];
        while (count($codes) < $count) {
            $raw = '';
            for ($i = 0; $i < 12; ++$i) {
                $raw .= self::ALPHABET[random_int(0, 31)];
            }
            $codes[$raw] = implode('-', str_split($raw, 4));
        }

        return array_values($codes);
    }

    public function normalize(string $code): string
    {
        $code = strtoupper(preg_replace('/[\s-]+/', '', $code) ?? '');

        return strtr($code, ['I' => '1', 'L' => '1', 'O' => '0']);
    }

    public function isWellFormed(string $code): bool
    {
        return (bool) preg_match('/^['.self::ALPHABET.']{12}$/', $this->normalize($code));
    }
}
