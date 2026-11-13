<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\IndexHtmlTitle;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Renders public/index.html from index.html.tpl with APP_NAME as page title. */
#[AsCommand(name: 'app:branding:apply-title', description: 'Set the initial page title of the SPA from APP_NAME')]
class BrandingApplyTitleCommand
{
    public function __construct(private readonly IndexHtmlTitle $title)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        try {
            $this->title->apply();
        } catch (\RuntimeException $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }
        $io->success('Page title set.');

        return Command::SUCCESS;
    }
}
