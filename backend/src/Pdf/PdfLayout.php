<?php

declare(strict_types=1);

namespace App\Pdf;

enum PdfLayout: string
{
    case MonthGrid = 'month-grid';
    case QuarterOverview = 'quarter-overview';
    case AnnualOverview = 'annual-overview';
    case Agenda = 'agenda';

    public function defaultOrientation(): string
    {
        return match ($this) {
            self::MonthGrid, self::Agenda => 'portrait',
            self::QuarterOverview, self::AnnualOverview => 'landscape',
        };
    }

    public function template(): string
    {
        return 'pdf/'.str_replace('-', '_', $this->value).'.html.twig';
    }

    public function available(\DateTimeImmutable $from, \DateTimeImmutable $to): bool
    {
        return match ($this) {
            self::MonthGrid, self::Agenda => true,
            self::QuarterOverview => ((int) $to->format('Y') * 12 + (int) $to->format('n')) - ((int) $from->format('Y') * 12 + (int) $from->format('n')) + 1 >= 3,
            self::AnnualOverview => '01-01' === $from->format('m-d') && '12-31' === $to->format('m-d') && $from->format('Y') === $to->format('Y'),
        };
    }
}
