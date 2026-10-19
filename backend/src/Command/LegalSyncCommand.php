<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\LegalDocumentService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Synchronises the legal Markdown files with the database (after migrations, on deploy and startup). */
#[AsCommand(name: 'app:legal:sync', description: 'Synchronise the legal documents (imprint, privacy, terms) from LEGAL_DOCUMENTS_PATH')]
class LegalSyncCommand
{
    public function __construct(private readonly LegalDocumentService $legal)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $report = $this->legal->sync();
        foreach ($report as $type => $result) {
            $io->writeln(sprintf('%s: %s', $type, $result));
            if (LegalDocumentService::MISSING === $result || LegalDocumentService::RETIRED === $result) {
                $io->writeln(sprintf('WARNING: %s document not provided (%s/%s.md)', $type, rtrim($this->legal->getPath(), '/'), $type));
            }
        }

        return Command::SUCCESS;
    }
}
