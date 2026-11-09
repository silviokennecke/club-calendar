<?php

declare(strict_types=1);

namespace App\Command;

use App\Dto\Club\CreateClubDto;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Service\ClubService;
use App\Service\EmailAddress;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * Operator: creates a club with an existing user as admin. Bypasses RESTRICT_CLUB_CREATION, keeps the
 * per-user club quota and the normal validation.
 */
#[AsCommand(name: 'app:club:create', description: 'Create a club with an existing user as admin')]
class ClubCreateCommand
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ClubService $clubs,
        private readonly ValidatorInterface $validator,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Option('Club name')] ?string $name = null,
        #[Option('E-mail address or id of an existing user who becomes admin')] ?string $admin = null,
        #[Option('Time zone')] string $timezone = 'Europe/Berlin',
    ): int {
        $interactive = $input->isInteractive();
        foreach (['name' => &$name, 'admin' => &$admin] as $field => &$value) {
            if (null === $value || '' === trim($value)) {
                if (!$interactive) {
                    $io->error(sprintf('The option --%s is missing.', $field));

                    return Command::FAILURE;
                }
                $value = (string) $io->ask('name' === $field ? 'Club name' : 'Admin (e-mail address or user id)');
            }
        }
        unset($value);

        $dto = new CreateClubDto();
        $dto->name = trim((string) $name);
        $dto->timezone = $timezone;
        $violations = $this->validator->validate($dto);
        if (\count($violations) > 0) {
            $io->error(sprintf('Invalid %s: %s', $violations->get(0)->getPropertyPath(), $violations->get(0)->getMessage()));

            return Command::FAILURE;
        }

        $repo = $this->em->getRepository(User::class);
        $user = $repo->find((string) $admin) ?? $repo->findOneBy(['email' => EmailAddress::normalize((string) $admin)]);
        if (!$user instanceof User) {
            $io->error('No user with this e-mail address or id exists.');

            return Command::FAILURE;
        }

        try {
            $club = $this->clubs->createClub($user, $dto->name, $dto->timezone, true);
        } catch (ApiProblemException $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }

        $io->success('Club created: '.$club['id']);

        return Command::SUCCESS;
    }
}
