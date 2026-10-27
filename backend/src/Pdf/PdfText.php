<?php

declare(strict_types=1);

namespace App\Pdf;

final class PdfText
{
    /** Emoji are drawn as images only for property icons; everywhere else they are removed so dompdf draws no boxes. */
    public static function stripEmoji(string $text): string
    {
        $stripped = preg_replace(
            '/[\p{Extended_Pictographic}\x{FE0F}\x{200D}\x{20E3}\x{1F3FB}-\x{1F3FF}\x{1F1E6}-\x{1F1FF}\x{E0020}-\x{E007F}]/u',
            '',
            $text,
        );

        return null === $stripped ? '' : $stripped;
    }

    public static function truncate(string $text, int $max): string
    {
        if ($max < 1 || mb_strlen($text) <= $max) {
            return $text;
        }

        return rtrim(mb_substr($text, 0, $max - 1)).'…';
    }
}
