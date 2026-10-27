<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PdfTranslationsTest extends TestCase
{
    private const string DIR = __DIR__.'/../../translations/';

    /** @return array<string, string> flattened key => value */
    private static function load(string $locale): array
    {
        $file = self::DIR.'pdf+intl-icu.'.$locale.'.json';
        self::assertFileExists($file);
        $data = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($data);

        return self::flatten($data);
    }

    /**
     * @param array<mixed> $data
     *
     * @return array<string, string>
     */
    private static function flatten(array $data, string $prefix = ''): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            $path = '' === $prefix ? (string) $key : $prefix.'.'.$key;
            if (is_array($value)) {
                $result += self::flatten($value, $path);
            } else {
                self::assertIsString($value, 'Value of '.$path.' must be a string.');
                $result[$path] = $value;
            }
        }

        return $result;
    }

    /** @return list<string> */
    private static function placeholders(string $message): array
    {
        preg_match_all('/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/', $message, $matches);
        $names = array_unique($matches[1]);
        sort($names);

        return $names;
    }

    public function testBothLocalesHaveTheSameKeys(): void
    {
        $de = self::load('de');
        $en = self::load('en');

        self::assertNotEmpty($de);
        self::assertSame(array_keys($de), array_keys($en));
    }

    public function testPlaceholdersMatchPerKey(): void
    {
        $de = self::load('de');
        $en = self::load('en');

        foreach ($de as $key => $message) {
            self::assertSame(self::placeholders($message), self::placeholders($en[$key]), 'Placeholders differ for '.$key);
        }
    }
}
