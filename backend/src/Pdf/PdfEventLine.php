<?php

declare(strict_types=1);

namespace App\Pdf;

/**
 * Text of one event line (`time emoji title (features)`, the title part built here) cut by an estimated glyph width:
 * dompdf wraps lines with inline images despite `white-space: nowrap` and does not clip them reliably.
 */
final class PdfEventLine
{
    private const float SAFETY = 0.94;
    private const float EMOJI_EM = 1.1;
    private const float DEFAULT_EM = 0.62;
    private const float UPPER_EM = 0.72;
    private const float DIGIT_EM = 0.64;
    private const float SPACE_EM = 0.32;
    /** Advance widths (em) of DejaVu Sans glyphs that differ much from the lower/upper/digit defaults. */
    private const array EM = [
        ' ' => self::SPACE_EM, 'i' => 0.28, 'j' => 0.28, 'l' => 0.28, 'f' => 0.35, 't' => 0.39, 'r' => 0.41, 'I' => 0.3, 'J' => 0.3,
        '.' => 0.32, ',' => 0.32, ':' => 0.34, ';' => 0.34, '(' => 0.39, ')' => 0.39, '/' => 0.34, '-' => 0.36, '|' => 0.34,
        'm' => 0.97, 'w' => 0.82, 'M' => 0.86, 'W' => 0.99, 's' => 0.52, 'c' => 0.55, 'z' => 0.53, 'L' => 0.56,
    ];

    /**
     * "Title (features)" cut with an ellipsis so that time, emoji and text fit $cellEm (width of the line in em).
     *
     * @param array<string, mixed> $event keys time (?string), emojiPaths, title, features
     */
    public static function text(array $event, float $cellEm, float $font): string
    {
        $text = (string) $event['title'];
        if ([] !== $event['features']) {
            $text .= ' ('.implode(', ', $event['features']).')';
        }
        $prefix = 0.0;
        if (null !== $event['time']) {
            $prefix += self::emWidth((string) $event['time']) + self::SPACE_EM;
        }
        $prefix += count($event['emojiPaths']) * (self::EMOJI_EM + 1.0 / $font) + ([] !== $event['emojiPaths'] ? self::SPACE_EM : 0.0);
        $budget = ($cellEm - $prefix) * self::SAFETY;
        if (self::emWidth($text) <= $budget) {
            return $text;
        }

        $room = $budget - self::emWidth('…');
        $out = '';
        $used = 0.0;
        foreach (mb_str_split($text) as $char) {
            $used += self::emWidth($char);
            if ($used > $room) {
                break;
            }
            $out .= $char;
        }

        return rtrim($out).'…';
    }

    public static function emWidth(string $text): float
    {
        $sum = 0.0;
        foreach (mb_str_split($text) as $char) {
            $sum += self::EM[$char] ?? (1 === preg_match('/\p{Lu}/u', $char) ? self::UPPER_EM : (1 === preg_match('/\d/', $char) ? self::DIGIT_EM : self::DEFAULT_EM));
        }

        return $sum;
    }
}
