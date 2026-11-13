<?php

declare(strict_types=1);

namespace App\Command;

use App\Storage\StorageChecker;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:storage:check', description: 'Write, read back and delete a probe object in the configured file storage')]
class StorageCheckCommand
{
    public function __construct(private readonly StorageChecker $checker)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        try {
            $io->listing($this->checker->describe());
            $this->checker->probe();
        } catch (\Throwable $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }
        $io->success('Storage works: probe object written, read back and deleted.');

        return Command::SUCCESS;
    }
}
