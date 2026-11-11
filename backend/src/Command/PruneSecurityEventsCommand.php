<?php

declare(strict_types=1);

namespace App\Command;

use App\Repository\SecurityEventRepository;
use Psr\Clock\ClockInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Cron: deletes security events older than one year. */
#[AsCommand(name: 'app:prune-security-events', description: 'Delete security events older than one year')]
class PruneSecurityEventsCommand
{
    public function __construct(
        private readonly SecurityEventRepository $events,
        private readonly ClockInterface $clock,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $before = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->modify('-1 year');
        $io->success(sprintf('Deleted %d security event(s) older than one year.', $this->events->pruneBefore($before)));

        return Command::SUCCESS;
    }
}
