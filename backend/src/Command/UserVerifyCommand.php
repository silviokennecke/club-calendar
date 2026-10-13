<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/** Support / dev / E2E: marks a user's e-mail address as confirmed without the link. */
#[AsCommand(name: 'app:user:verify', description: 'Mark the e-mail address of a user as verified')]
class UserVerifyCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
    ) {
    }

    public function __invoke(SymfonyStyle $io, #[Argument('E-mail address of the user')] string $email): int
    {
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        if (null === $user || 0 !== strcasecmp($user->getEmail(), $email)) {
            $io->error('No user with this e-mail address.');

            return Command::FAILURE;
        }
        $user->setIsEmailVerified(true);
        $this->em->flush();
        $io->success('E-mail address verified.');

        return Command::SUCCESS;
    }
}
