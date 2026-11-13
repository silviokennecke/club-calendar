<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\HolidayRefreshService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:holidays:refresh', description: 'Re-fetch predefined (OpenHolidays) holiday calendars')]
class HolidaysRefreshCommand
{
    public function __construct(
        private readonly HolidayRefreshService $refresher,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Option(description: 'Refresh all predefined holiday calendars')] bool $all = false,
        #[Option(description: 'Refresh one holiday calendar by id')] ?string $calendar = null,
    ): int {
        if (!$all && null === $calendar) {
            $io->error('Pass --all or --calendar=<id>.');

            return Command::INVALID;
        }

        $failed = 0;
        $results = $this->refresher->refresh($calendar);
        foreach ($results as $result) {
            if (null !== $result->error) {
                ++$failed;
                $io->warning(sprintf('%s failed: %s', $result->name, $result->error->getMessage()));
            } else {
                $io->writeln(sprintf('%s: %d event(s)', $result->name, $result->events));
            }
        }
        if ([] === $results) {
            $io->note('No predefined holiday calendars found.');
        }

        return $failed > 0 ? Command::FAILURE : Command::SUCCESS;
    }
}
