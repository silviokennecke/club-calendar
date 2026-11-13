<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** Renders the SPA's index.html from the pristine build template with the instance name as <title>. */
class IndexHtmlTitle
{
    public const string MARKER = '<title>Club Calendar</title>';

    public function __construct(
        private readonly AppBranding $branding,
        #[Autowire('%kernel.project_dir%/index.html.tpl')]
        private readonly string $templatePath,
        #[Autowire('%kernel.project_dir%/public/index.html')]
        private readonly string $targetPath,
    ) {
    }

    public function templateExists(): bool
    {
        return is_file($this->templatePath);
    }

    /** @throws \RuntimeException when the template is unreadable, the marker is not unique or the write fails */
    public function apply(): void
    {
        $html = is_file($this->templatePath) ? @file_get_contents($this->templatePath) : false;
        if (false === $html) {
            throw new \RuntimeException('index.html template is not readable');
        }
        if (1 !== substr_count($html, self::MARKER)) {
            throw new \RuntimeException('title marker not found exactly once in the index.html template');
        }

        $escaped = htmlspecialchars($this->branding->name(), ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
        $rendered = str_replace(self::MARKER, '<title>'.$escaped.'</title>', $html);

        // Temp file + rename: the web server never serves a half-written index.html
        $tmp = dirname($this->targetPath).'/.index.html.'.bin2hex(random_bytes(4)).'.tmp';
        if (false === @file_put_contents($tmp, $rendered)) {
            @unlink($tmp);
            throw new \RuntimeException('could not write the temporary index.html');
        }
        @chmod($tmp, 0644);
        if (!@rename($tmp, $this->targetPath)) {
            @unlink($tmp);
            throw new \RuntimeException('could not replace index.html');
        }
    }
}
