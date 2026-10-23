<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/** Finds a user by id (UUID) or by e-mail address (console commands). */
readonly class UserLookup
{
    public function __construct(private EntityManagerInterface $em)
    {
    }

    public function find(string $idOrEmail): ?User
    {
        $idOrEmail = trim($idOrEmail);
        if ('' === $idOrEmail) {
            return null;
        }
        $repository = $this->em->getRepository(User::class);
        if (Uuid::isValid($idOrEmail)) {
            return $repository->find(Uuid::fromString($idOrEmail)->toRfc4122());
        }
        $email = EmailAddress::normalize($idOrEmail);
        $user = $repository->findOneBy(['email' => $email]);
        // The column collation also matches look-alike spellings ("é" = "e"): only the exact address counts.
        if (null === $user || $user->getEmail() !== $email) {
            return null;
        }

        return $user;
    }
}
