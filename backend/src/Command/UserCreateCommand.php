<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use App\Service\EmailAddress;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * Operator: creates a confirmed user (e.g. the first one while RESTRICT_REGISTRATION=true). The address counts
 * as verified, no mail goes out and no consent is recorded (the consent gate asks at the first sign-in).
 */
#[AsCommand(name: 'app:user:create', description: 'Create a user with a verified e-mail address')]
class UserCreateCommand
{
    use PasswordInputTrait;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserPasswordHasherInterface $hasher,
        private readonly ValidatorInterface $validator,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        InputInterface $input,
        #[Option('Display name')] ?string $name = null,
        #[Option('E-mail address')] ?string $email = null,
        #[Option('Password (visible in the shell history: prefer --password-stdin or the prompt)')] ?string $password = null,
        #[Option('Read the password from the first line of STDIN', name: 'password-stdin')] bool $passwordStdin = false,
        #[Option('Interface language (de or en)')] ?string $language = null,
    ): int {
        $interactive = $input->isInteractive();
        foreach (['name' => &$name, 'email' => &$email] as $field => &$value) {
            if (null === $value) {
                if (!$interactive) {
                    $io->error(sprintf('The option --%s is missing.', $field));

                    return Command::FAILURE;
                }
                $value = (string) $io->ask(ucfirst($field), null, function (?string $answer) use ($field): string {
                    $answer = (string) $answer;
                    $message = $this->violation($this->validator, $field, $answer);
                    if (null !== $message) {
                        throw new \RuntimeException($message);
                    }

                    return $answer;
                });
            } elseif (null !== $message = $this->violation($this->validator, $field, $value)) {
                $io->error(sprintf('Invalid %s: %s', $field, $message));

                return Command::FAILURE;
            }
        }
        unset($value);
        if (null !== $language && !\in_array($language, ['de', 'en'], true)) {
            $io->error('The language must be "de" or "en".');

            return Command::FAILURE;
        }

        $email = EmailAddress::normalize((string) $email);
        // Before the password prompt: no point in asking when the address is taken.
        if (null !== $this->em->getRepository(User::class)->findOneBy(['email' => $email])) {
            $io->error('A user with this e-mail address already exists.');

            return Command::FAILURE;
        }
        $password = $this->readPassword($io, $input, $this->validator, $password, $passwordStdin);
        if (null === $password) {
            return Command::FAILURE;
        }

        $user = new User();
        $user->setName($name);
        $user->setEmail($email);
        $user->setPassword($this->hasher->hashPassword($user, $password));
        $user->setIsEmailVerified(true);
        if (null !== $language) {
            $user->setLanguage($language);
        }
        $this->em->persist($user);
        $this->em->flush();

        $io->success('User created: '.$user->getId());

        return Command::SUCCESS;
    }
}
