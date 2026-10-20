<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\EmailVerification;
use App\Service\UserLookup;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Support / dev / E2E: marks a user's e-mail address as confirmed without the code and removes the pending
 * confirmation codes (so no stale code or lock remains).
 */
#[AsCommand(
    name: 'app:user:verify',
    description: 'Mark the e-mail address of a user as verified (activates the account)',
    aliases: ['app:user:activate'],
)]
class UserVerifyCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserLookup $users,
    ) {
    }

    public function __invoke(SymfonyStyle $io, #[Argument('User id (UUID) or e-mail address')] string $user): int
    {
        $found = $this->users->find($user);
        if (null === $found) {
            $io->error('No user with this id or e-mail address.');

            return Command::FAILURE;
        }
        $alreadyVerified = $found->isEmailVerified();
        $found->setIsEmailVerified(true);
        $this->em->createQueryBuilder()
            ->delete(EmailVerification::class, 'v')
            ->where('v.user = :user')
            ->setParameter('user', $found)
            ->getQuery()
            ->execute();
        $this->em->flush();
        $io->success($alreadyVerified ? 'The e-mail address was already verified.' : 'E-mail address verified.');

        return Command::SUCCESS;
    }
}
