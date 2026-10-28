<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\HolidayCalendar;
use App\Enum\HolidaySource;
use App\Service\HolidayCalendarService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(name: 'app:holidays:refresh', description: 'Re-fetch predefined (OpenHolidays) holiday calendars')]
class HolidaysRefreshCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly HolidayCalendarService $service,
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

        $criteria = ['source' => HolidaySource::OPENHOLIDAYS];
        if (null !== $calendar) {
            $criteria['id'] = $calendar;
        }
        $failed = 0;
        $items = $this->em->getRepository(HolidayCalendar::class)->findBy($criteria);
        foreach ($items as $hc) {
            try {
                $count = $this->service->fetchAndStore($hc);
                $io->writeln(sprintf('%s: %d event(s)', $hc->getName(), $count));
            } catch (\Throwable $e) {
                ++$failed;
                $io->warning(sprintf('%s failed: %s', $hc->getName(), $e->getMessage()));
            }
        }
        if ([] === $items) {
            $io->note('No predefined holiday calendars found.');
        }

        return $failed > 0 ? Command::FAILURE : Command::SUCCESS;
    }
}
