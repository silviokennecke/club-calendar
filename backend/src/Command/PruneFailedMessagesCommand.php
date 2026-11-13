<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\FailedMessagePruner;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Deletes failed background messages older than 30 days. */
#[AsCommand(name: 'app:prune-failed-messages', description: 'Delete failed background messages older than 30 days')]
class PruneFailedMessagesCommand
{
    public function __construct(private readonly FailedMessagePruner $pruner)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $io->success(sprintf('Deleted %d failed message(s) older than 30 days.', $this->pruner->prune()));

        return Command::SUCCESS;
    }
}
