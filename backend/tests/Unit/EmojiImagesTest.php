<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\EmojiImages;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class EmojiImagesTest extends TestCase
{
    private const string DIR = __DIR__.'/../../assets/pdf/emoji';

    private EmojiImages $images;

    protected function setUp(): void
    {
        $this->images = new EmojiImages(self::DIR);
    }

    /** @return iterable<string, array{string, string}> */
    public static function resolvable(): iterable
    {
        yield 'simple' => ["\u{1F600}", 'emoji_u1f600.png'];
        yield 'fe0f dropped' => ["\u{2764}\u{FE0F}", 'emoji_u2764.png'];
        yield 'bare heart' => ["\u{2764}", 'emoji_u2764.png'];
        yield 'zwj family' => ["\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", 'emoji_u1f468_200d_1f469_200d_1f467.png'];
        yield 'flag' => ["\u{1F1E9}\u{1F1EA}", 'emoji_u1f1e9_1f1ea.png'];
        yield 'keycap' => ["#\u{FE0F}\u{20E3}", 'emoji_u0023_20e3.png'];
    }

    #[DataProvider('resolvable')]
    public function testResolvesBundledEmoji(string $icon, string $file): void
    {
        $path = $this->images->resolve($icon);

        self::assertSame(self::DIR.'/'.$file, $path);
        self::assertFileExists((string) $path);
    }

    /** @return iterable<string, array{string}> */
    public static function rejected(): iterable
    {
        yield 'empty' => [''];
        yield 'free text' => ['Schuetzentracht'];
        yield 'ascii letter' => ['a'];
        yield 'img tag' => ['<img src="/etc/passwd">'];
        yield 'path traversal' => ['../../etc/passwd'];
        yield 'multi emoji' => ["\u{1F600}\u{1F601}"];
        yield 'too long' => [str_repeat("\u{1F600}", 33)];
        yield 'long ascii' => [str_repeat('a', 33)];
        yield 'skin tone variant not bundled' => ["\u{1F44D}\u{1F3FD}"];
        yield 'unassigned codepoint' => ["\u{10FFFD}"];
        yield 'invalid utf8' => ["\xFF\xFE"];
        yield 'emoji with text' => ["\u{1F600} x"];
        yield 'nul byte' => ["\u{1F600}\0"];
    }

    #[DataProvider('rejected')]
    public function testRejectsEverythingElse(string $icon): void
    {
        self::assertNull($this->images->resolve($icon));
    }

    public function testNormalisesToNfc(): void
    {
        // "e" + combining acute is not an emoji either way, but must not blow up
        self::assertNull($this->images->resolve("e\u{0301}"));
    }

    public function testManifestMatchesFiles(): void
    {
        $manifest = json_decode((string) file_get_contents(self::DIR.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($manifest);
        $sorted = $manifest;
        sort($sorted, SORT_STRING);
        self::assertSame($sorted, $manifest);
        foreach ($manifest as $key) {
            self::assertMatchesRegularExpression('/^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,9}$/', $key);
            self::assertFileExists(self::DIR.'/emoji_u'.$key.'.png');
        }
        self::assertCount(\count(glob(self::DIR.'/emoji_u*.png') ?: []), $manifest);
    }

    public function testIgnoresPathsMissingFromManifest(): void
    {
        $dir = sys_get_temp_dir().'/emoji-'.bin2hex(random_bytes(4));
        mkdir($dir);
        file_put_contents($dir.'/manifest.json', json_encode(['1f600', '../x', 'zz']));
        try {
            $images = new EmojiImages($dir);
            self::assertSame($dir.'/emoji_u1f600.png', $images->resolve("\u{1F600}"));
            self::assertNull($images->resolve("\u{1F601}"));
        } finally {
            unlink($dir.'/manifest.json');
            rmdir($dir);
        }
    }
}
