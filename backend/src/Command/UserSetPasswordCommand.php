<?php

declare(strict_types=1);

namespace App\Command;

use App\Opaque\OpaqueCutoff;
use App\Service\AccountMailer;
use App\Service\AccountService;
use App\Service\PasswordResetService;
use App\Service\UserLookup;
use Psr\Clock\ClockInterface;
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
 * With OPAQUE on (or --link) it instead removes the current password (hash and OPAQUE record) and prints a one-time
 * password-set link; --password stays a legacy (bcrypt) password, refused after the cutoff without --force-legacy.
 */
#[AsCommand(name: 'app:user:set-password', description: 'Set a new password for a user (ends all sessions)')]
class UserSetPasswordCommand
{
    use PasswordInputTrait;

    public function __construct(
        private readonly UserLookup $users,
        private readonly AccountService $accounts,
        private readonly ValidatorInterface $validator,
        private readonly OpaqueCutoff $cutoff,
        private readonly ClockInterface $clock,
        private readonly PasswordResetService $passwordResets,
        private readonly AccountMailer $mailer,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Argument('User id (UUID) or e-mail address')] string $user,
        #[Option('Password (visible in the shell history: prefer --password-stdin or the prompt)')] ?string $password = null,
        #[Option('Read the password from the first line of STDIN', name: 'password-stdin')] bool $passwordStdin = false,
        #[Option('Remove the password and print a one-time password-set link (the default unless a password is given)')] bool $link = false,
        #[Option('Allow --password after the OPAQUE cutoff', name: 'force-legacy')] bool $forceLegacy = false,
    ): int {
        $found = $this->users->find($user);
        if (null === $found) {
            $io->error('No user with this id or e-mail address.');

            return Command::FAILURE;
        }
        $passwordGiven = null !== $password || $passwordStdin;
        if ($link && $passwordGiven) {
            $io->error('Use either --link or --password/--password-stdin, not both.');

            return Command::FAILURE;
        }
        if ($link || !$passwordGiven) {
            $this->accounts->revokePasswordAsOperator($found);
            $io->writeln($this->mailer->passwordResetUrl($this->passwordResets->createToken($found)));
            $io->success('Password removed; all sessions of the user ended. The link above sets a new one (valid 60 minutes, once).');

            return Command::SUCCESS;
        }
        if ($passwordGiven && !$this->acceptLegacyPassword($io, $this->cutoff, $this->clock, $forceLegacy)) {
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
