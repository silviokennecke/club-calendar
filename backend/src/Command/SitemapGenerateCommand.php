<?php

declare(strict_types=1);

namespace App\Command;

use App\Sitemap\SitemapGenerator;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Operator / entrypoint: regenerates the sitemap of the PUBLIC feeds in the file storage (also a scheduler job). */
#[AsCommand(name: 'app:sitemap:generate', description: 'Generate the sitemap files of public feeds in the file storage')]
class SitemapGenerateCommand
{
    public function __construct(private readonly SitemapGenerator $generator)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $result = $this->generator->generate();
        $io->success(sprintf('%d feeds, %d URLs in %d file(s).', $result->feedCount, $result->urlCount, count($result->files)));

        return Command::SUCCESS;
    }
}
