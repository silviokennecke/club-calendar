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

    /** `portrait` or `landscape` (auto = layout default). */
    public function resolvedOrientation(): string
    {
        return 'auto' === $this->orientation ? $this->layout->defaultOrientation() : $this->orientation;
    }
}
