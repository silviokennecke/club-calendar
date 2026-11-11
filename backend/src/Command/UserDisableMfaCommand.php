<?php

declare(strict_types=1);

namespace App\Command;

use App\Security\ClientContext;
use App\Service\MfaService;
use App\Service\UserLookup;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Operator recovery: turns two-step sign-in off for a user who lost the authenticator app and backup codes.
 * Like the profile action it removes TOTP and backup codes and ends all sessions and connected apps (passkeys
 * stay); it records a security event (method cli) and mails the user. Nothing happens if MFA is not on.
 */
#[AsCommand(name: 'app:user:disable-mfa', description: 'Turn off two-step sign-in for a user (ends all sessions)')]
class UserDisableMfaCommand
{
    public function __construct(
        private readonly UserLookup $users,
        private readonly MfaService $mfa,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument('User id (UUID) or e-mail address')] string $user,
    ): int {
        $found = $this->users->find($user);
        if (null === $found) {
            $io->error('No user with this id or e-mail address.');

            return Command::FAILURE;
        }
        if (!$found->isMfaEnforced()) {
            $io->success('Two-step sign-in is not on for this user; nothing changed.');

            return Command::SUCCESS;
        }
        $this->mfa->disable($found, new ClientContext(), 'cli');
        $io->success('Two-step sign-in turned off; all sessions of the user ended and the user was notified by e-mail.');

        return Command::SUCCESS;
    }
}
