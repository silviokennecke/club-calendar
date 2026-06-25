<?php

namespace App\Security;

use Symfony\Component\Security\Core\Exception\UnsupportedUserException;
use Symfony\Component\Security\Core\Exception\UserNotFoundException;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Security\Core\User\UserProviderInterface;

/**
 * Stub UserProvider — will be fully implemented in a later task.
 *
 * @implements UserProviderInterface<UserInterface>
 */
class UserProvider implements UserProviderInterface
{
    public function loadUserByIdentifier(string $identifier): UserInterface
    {
        throw new UserNotFoundException('UserProvider not yet implemented.');
    }

    public function refreshUser(UserInterface $user): UserInterface
    {
        throw new UnsupportedUserException('UserProvider not yet implemented.');
    }

    public function supportsClass(string $class): bool
    {
        return false;
    }
}
