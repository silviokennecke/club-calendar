<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

#[AsCommand(
    name: 'app:prune-unverified-users',
    description: 'Delete unverified user accounts older than 30 days',
)]
class PruneUnverifiedUsersCommand extends Command
{
    public function __construct(
        private readonly EntityManagerInterface $em,
    ) {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $cutoff = new \DateTimeImmutable('-30 days');

        $deleted = $this->em->createQueryBuilder()
            ->delete(User::class, 'u')
            ->where('u.isEmailVerified = :verified')
            ->andWhere('u.createdAt < :cutoff')
            ->setParameter('verified', false)
            ->setParameter('cutoff', $cutoff)
            ->getQuery()
            ->execute();

        $io->success(sprintf('Deleted %d unverified user(s) older than 30 days.', $deleted));

        return Command::SUCCESS;
    }
}
