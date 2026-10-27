<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Pdf\PdfText;
use PHPUnit\Framework\TestCase;

class PdfTextTest extends TestCase
{
    public function testStripEmoji(): void
    {
        self::assertSame('Training ', PdfText::stripEmoji("Training \u{1F3AF}"));
        self::assertSame('Herz', PdfText::stripEmoji("Herz\u{2764}\u{FE0F}"));
        self::assertSame('Familie', PdfText::stripEmoji("Familie\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}"));
        self::assertSame('Daumen', PdfText::stripEmoji("Daumen\u{1F44D}\u{1F3FD}"));
        self::assertSame('Flagge', PdfText::stripEmoji("Flagge\u{1F1E9}\u{1F1EA}"));
        self::assertSame('England', PdfText::stripEmoji("England\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"));
        self::assertSame('1', PdfText::stripEmoji("1\u{FE0F}\u{20E3}"));
    }

    public function testStripEmojiKeepsOrdinaryText(): void
    {
        $text = 'Schützenfest Ärger ß – 10:00 (Halle #2) 100%';
        self::assertSame($text, PdfText::stripEmoji($text));
        self::assertSame('', PdfText::stripEmoji(''));
        self::assertSame('日本語', PdfText::stripEmoji('日本語'));
    }

    public function testTruncate(): void
    {
        self::assertSame('abc', PdfText::truncate('abc', 3));
        self::assertSame('ab…', PdfText::truncate('abcdef', 3));
        self::assertSame('Ärg…', PdfText::truncate('Ärger', 4));
        self::assertSame('abcdef', PdfText::truncate('abcdef', 0));
    }
}
