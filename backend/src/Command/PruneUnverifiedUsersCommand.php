<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\UnverifiedUserPruner;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(
    name: 'app:prune-unverified-users',
    description: 'Delete unverified user accounts older than 30 days (members of a club are kept)',
)]
class PruneUnverifiedUsersCommand extends Command
{
    public function __construct(
        private readonly UnverifiedUserPruner $pruner,
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $deleted = $this->pruner->prune();

        $io->success(sprintf('Deleted %d unverified user(s) older than 30 days.', $deleted));

        return Command::SUCCESS;
    }
}
