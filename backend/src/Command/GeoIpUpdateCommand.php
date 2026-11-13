<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\GeoIpUpdater;
use App\Service\GeoIpUpdateStatus;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Operator / entrypoint: downloads the GeoLite2 City database from MaxMind and replaces the local file atomically. */
#[AsCommand(name: 'app:geoip:update', description: 'Download the GeoLite2 City database (needs MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY)')]
class GeoIpUpdateCommand
{
    public function __construct(private readonly GeoIpUpdater $updater)
    {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Option('Update even when the file is younger than 3 days')] bool $force = false,
    ): int {
        $result = $this->updater->update($force);
        switch ($result->status) {
            case GeoIpUpdateStatus::NotConfigured:
            case GeoIpUpdateStatus::Skipped:
                $io->note($result->message);

                return Command::SUCCESS;
            case GeoIpUpdateStatus::Failed:
                $io->error($result->message);

                return Command::FAILURE;
            case GeoIpUpdateStatus::Updated:
                $io->success($result->message);

                return Command::SUCCESS;
        }
    }
}
