<?php

declare(strict_types=1);

namespace App\Sitemap;

/** One `<urlset>` file being written to a temp stream (spills to disk when large). */
final class SitemapPart
{
    public int $count = 0;
    public ?string $lastmod = null;
    /** @var resource */
    private $stream;

    public function __construct()
    {
        $stream = fopen('php://temp/maxmemory:2097152', 'w+b');
        if (false === $stream) {
            throw new \RuntimeException('Cannot open a temporary stream.');
        }
        $this->stream = $stream;
        fwrite($this->stream, '<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n");
    }

    public function add(string $loc, ?string $lastmod): void
    {
        $line = '  <url><loc>'.self::escape($loc).'</loc>';
        if (null !== $lastmod) {
            $line .= '<lastmod>'.$lastmod.'</lastmod>';
            if (null === $this->lastmod || $lastmod > $this->lastmod) {
                $this->lastmod = $lastmod;
            }
        }
        fwrite($this->stream, $line."</url>\n");
        ++$this->count;
    }

    /** @return resource rewound stream, the caller closes it */
    public function finish()
    {
        fwrite($this->stream, '</urlset>'."\n");
        rewind($this->stream);

        return $this->stream;
    }

    public static function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
