<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use App\Service\AccountMailer;
use App\Service\EmailAddress;
use App\Service\PasswordResetService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Output\ConsoleOutputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Support / dev / E2E: creates a password reset link (like forgot-password, 60 minutes, once) without
 * sending a mail and prints only the URL. CLI only: there is no HTTP way to get a link without the mailbox.
 */
#[AsCommand(name: 'app:user:reset-link', description: 'Create a password reset link for a user and print the URL')]
class UserResetLinkCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly PasswordResetService $passwordResets,
        private readonly AccountMailer $mailer,
    ) {
    }

    public function __invoke(OutputInterface $output, #[Argument('E-mail address of the user')] string $email): int
    {
        $email = EmailAddress::normalize($email);
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (null === $user || $user->getEmail() !== $email) {
            $error = $output instanceof ConsoleOutputInterface ? $output->getErrorOutput() : $output;
            $error->writeln('No user with this e-mail address.');

            return Command::FAILURE;
        }
        $output->writeln($this->mailer->passwordResetUrl($this->passwordResets->createToken($user)));

        return Command::SUCCESS;
    }
}
