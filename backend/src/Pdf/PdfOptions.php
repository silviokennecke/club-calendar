<?php

declare(strict_types=1);

namespace App\Pdf;

use App\Service\Input;

/** Validated layout, paper and orientation; only these fixed values ever reach the `@page` rule. */
final readonly class PdfOptions
{
    public const array PAPERS = ['a4', 'a3'];
    public const array ORIENTATIONS = ['auto', 'portrait', 'landscape'];

    public function __construct(
        public PdfLayout $layout,
        public string $paper = 'a4',
        public string $orientation = 'auto',
    ) {
        if (!\in_array($paper, self::PAPERS, true) || !\in_array($orientation, self::ORIENTATIONS, true)) {
            throw new \InvalidArgumentException('Invalid paper or orientation.');
        }
    }

    /** Raw request values: a bad value is a 400 with the field name. */
    public static function fromRequest(mixed $layout, mixed $paper, mixed $orientation): self
    {
        $layoutEnum = \is_string($layout) ? PdfLayout::tryFrom($layout) : null;
        if (null === $layoutEnum) {
            throw Input::invalid('layout', 'layout must be one of month-grid, quarter-overview, annual-overview, agenda');
        }
        $paper = null === $paper || '' === $paper ? 'a4' : $paper;
        if (!\is_string($paper) || !\in_array($paper, self::PAPERS, true)) {
            throw Input::invalid('paper', 'paper must be a4 or a3');
        }
        $orientation = null === $orientation || '' === $orientation ? 'auto' : $orientation;
        if (!\is_string($orientation) || !\in_array($orientation, self::ORIENTATIONS, true)) {
            throw Input::invalid('orientation', 'orientation must be auto, portrait or landscape');
        }

        return new self($layoutEnum, $paper, $orientation);
    }

    /** Printable page height in points: paper height minus the vertical `@page` margins of base.html.twig (15 + 18 mm). */
    public function contentHeightPt(): float
    {
        $sides = 'a4' === $this->paper ? [210.0, 297.0] : [297.0, 420.0];
        $heightMm = 'landscape' === $this->resolvedOrientation() ? $sides[0] : $sides[1];

        return ($heightMm - 33.0) * 72.0 / 25.4;
    }

    /** Printable page width in points: paper width minus the horizontal `@page` margins of base.html.twig (2 x 12 mm). */
    public function contentWidthPt(): float
    {
        $sides = 'a4' === $this->paper ? [210.0, 297.0] : [297.0, 420.0];
        $widthMm = 'landscape' === $this->resolvedOrientation() ? $sides[1] : $sides[0];

        return ($widthMm - 24.0) * 72.0 / 25.4;
    }

    /** `portrait` or `landscape` (auto = layout default). */
    public function resolvedOrientation(): string
    {
        return 'auto' === $this->orientation ? $this->layout->defaultOrientation() : $this->orientation;
    }
}
