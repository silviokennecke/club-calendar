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
        $user = $repository->findOneBy(['email' => $idOrEmail]);
        // The column collation also matches look-alike spellings: only the exact address (any case) counts.
        if (null === $user || 0 !== strcasecmp($user->getEmail(), $idOrEmail)) {
            return null;
        }

        return $user;
    }
}
