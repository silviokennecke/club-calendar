<?php

declare(strict_types=1);

namespace App\Command;

use App\Service\AccountService;
use App\Service\UserLookup;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * Operator: sets a new password. Like a password reset it ends all sessions, voids open reset links and
 * discards a waiting e-mail change; it neither changes the verification state nor sends a mail.
 */
#[AsCommand(name: 'app:user:set-password', description: 'Set a new password for a user (ends all sessions)')]
class UserSetPasswordCommand
{
    use PasswordInputTrait;

    public function __construct(
        private readonly UserLookup $users,
        private readonly AccountService $accounts,
        private readonly ValidatorInterface $validator,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Argument('User id (UUID) or e-mail address')] string $user,
        #[Option('Password (visible in the shell history: prefer --password-stdin or the prompt)')] ?string $password = null,
        #[Option('Read the password from the first line of STDIN', name: 'password-stdin')] bool $passwordStdin = false,
    ): int {
        $found = $this->users->find($user);
        if (null === $found) {
            $io->error('No user with this id or e-mail address.');

            return Command::FAILURE;
        }
        $password = $this->readPassword($io, $input, $this->validator, $password, $passwordStdin);
        if (null === $password) {
            return Command::FAILURE;
        }
        $this->accounts->setPasswordAsOperator($found, $password);
        $io->success('Password set; all sessions of the user ended.');

        return Command::SUCCESS;
    }
}
