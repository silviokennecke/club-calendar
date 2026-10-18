<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\ClubInvitationService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Cron: deletes invitations that were answered, or expired, more than 30 days ago. */
#[AsCommand(name: 'app:prune-club-invitations', description: 'Delete club invitations that were answered or expired more than 30 days ago')]
class PruneClubInvitationsCommand
{
    public function __construct(private readonly ClubInvitationService $invitations)
    {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $io->success(sprintf('Deleted %d old club invitation(s).', $this->invitations->pruneOld()));

        return Command::SUCCESS;
    }
}
