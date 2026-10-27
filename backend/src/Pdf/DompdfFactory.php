<?php

declare(strict_types=1);

namespace App\Pdf;

use Dompdf\Dompdf;
use Dompdf\Options;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Hardened dompdf: nothing remote, no PHP/JS in templates, files only from the bundled asset directory (chroot).
 */
class DompdfFactory
{
    public function __construct(
        #[Autowire('%kernel.project_dir%/assets/pdf')]
        private readonly string $chroot,
        #[Autowire('%kernel.cache_dir%/pdf')]
        private readonly string $cacheDir,
    ) {
    }

    public function create(): Dompdf
    {
        if (!is_dir($this->cacheDir) && !@mkdir($this->cacheDir, 0o775, true) && !is_dir($this->cacheDir)) {
            throw new \RuntimeException('PDF cache directory could not be created.');
        }

        $options = new Options();
        $options->setIsRemoteEnabled(false);
        $options->setIsPhpEnabled(false);
        $options->setIsJavascriptEnabled(false);
        $options->setIsHtml5ParserEnabled(true);
        $options->setChroot([$this->chroot]);
        $options->setAllowedProtocols(['file://' => ['rules' => []]]);
        $options->setIsFontSubsettingEnabled(true);
        $options->setTempDir($this->cacheDir);
        $options->setFontCache($this->cacheDir);
        $options->setDefaultFont('DejaVu Sans');

        return new Dompdf($options);
    }
}
