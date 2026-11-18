<?php

declare(strict_types=1);

namespace App\Pdf;

use App\Ics\IcsEvent;

/**
 * Notices (event type `notice`) of the PDF export, kept apart from the per-day event entries: all-day, possibly
 * multi-day, printed as one line `Hinweis (<date or from – to>): <title> (<note>)` below the calendar or as agenda row.
 */
final class PdfNotices
{
    private const int MAX_TITLE = 200;
    /** Wrapping slack on top of the glyph width estimate (words do not break at the exact line end). */
    private const float WRAP_SLACK = 1.08;
    private const float SAFETY = 0.94;
    /** Width reference only; the printed label comes from the translations. */
    private const string LABEL_ESTIMATE = 'Hinweis';

    /**
     * @param list<IcsEvent> $events notice rows of the reader
     *
     * @return list<array{id: string, from: string, to: string, dates: string, title: string, note: string, draft: bool}>
     */
    public static function fromEvents(array $events, string $locale): array
    {
        $notices = [];
        foreach ($events as $e) {
            $to = $e->dateEnd ?? $e->date;
            if ($to < $e->date) {
                $to = $e->date;
            }
            $dates = PdfDates::formatDate(new \DateTimeImmutable($e->date), $locale);
            if ($to !== $e->date) {
                $dates .= ' – '.PdfDates::formatDate(new \DateTimeImmutable($to), $locale);
            }
            $notices[] = [
                'id' => $e->id,
                'from' => $e->date,
                'to' => $to,
                'dates' => $dates,
                'title' => PdfText::truncate(trim(PdfText::stripEmoji($e->name)), self::MAX_TITLE),
                'note' => self::collapse((string) $e->note),
                'draft' => $e->isDraft,
            ];
        }
        usort($notices, static fn (array $a, array $b): int => [$a['from'], $a['to'], $a['id']] <=> [$b['from'], $b['to'], $b['id']]);

        return $notices;
    }

    /** Line breaks and runs of whitespace become single spaces; emoji are removed like in other names. */
    public static function collapse(string $note): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', PdfText::stripEmoji($note)));
    }

    /**
     * @param list<array<string, mixed>> $notices
     *
     * @return list<array<string, mixed>> the notices overlapping firstYmd..lastYmd
     */
    public static function touching(array $notices, string $firstYmd, string $lastYmd): array
    {
        return array_values(array_filter($notices, static fn (array $n): bool => $n['from'] <= $lastYmd && $n['to'] >= $firstYmd));
    }

    /** Estimated number of printed lines of one notice (long text wraps, it is never cut). */
    public static function lines(array $notice, float $font, float $widthPt): int
    {
        $text = self::LABEL_ESTIMATE.' ('.$notice['dates'].'): '.$notice['title'].('' !== $notice['note'] ? ' ('.$notice['note'].')' : '');

        return max(1, (int) ceil(PdfEventLine::emWidth($text) * self::WRAP_SLACK * $font / ($widthPt * self::SAFETY)));
    }

    /** @param list<array<string, mixed>> $notices */
    public static function totalLines(array $notices, float $font, float $widthPt): int
    {
        return array_sum(array_map(static fn (array $n): int => self::lines($n, $font, $widthPt), $notices));
    }

    /**
     * Leading notices that fit $maxLines; the rest goes to a page of its own.
     *
     * @param list<array<string, mixed>> $notices
     *
     * @return array{0: list<array<string, mixed>>, 1: list<array<string, mixed>>}
     */
    public static function fit(array $notices, float $font, float $widthPt, int $maxLines): array
    {
        $used = 0;
        foreach ($notices as $i => $n) {
            $used += self::lines($n, $font, $widthPt);
            if ($used > $maxLines) {
                return [array_slice($notices, 0, $i), array_slice($notices, $i)];
            }
        }

        return [$notices, []];
    }
}
