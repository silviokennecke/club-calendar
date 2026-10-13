<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\AccountService;
use App\Service\PasswordResetService;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Cron: deletes expired password reset links and expired e-mail change confirmations. */
#[AsCommand(name: 'app:prune-password-resets', description: 'Delete expired password reset links and e-mail change confirmations')]
class PrunePasswordResetsCommand
{
    public function __construct(
        private readonly PasswordResetService $passwordResets,
        private readonly AccountService $accounts,
    ) {
    }

    public function __invoke(SymfonyStyle $io): int
    {
        $resets = $this->passwordResets->pruneExpired();
        $changes = $this->accounts->pruneExpiredEmailChanges();
        $io->success(sprintf('Deleted %d expired password reset link(s) and %d expired e-mail change(s).', $resets, $changes));

        return Command::SUCCESS;
    }
}
