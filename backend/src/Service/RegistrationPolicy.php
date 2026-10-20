<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Who may create an account. With RESTRICT_REGISTRATION only addresses with an open club invitation may
 * (password registration and the creation of a NEW user by SSO); sign-in and linking are not affected.
 */
readonly class RegistrationPolicy
{
    public function __construct(
        private ClubInvitationService $invitations,
        #[Autowire(param: 'app.restrict_registration')]
        private bool $restricted,
    ) {
    }

    public function isRestricted(): bool
    {
        return $this->restricted;
    }

    public function mayRegister(string $email): bool
    {
        return !$this->restricted || $this->invitations->hasOpenInvitationFor($email);
    }
}
