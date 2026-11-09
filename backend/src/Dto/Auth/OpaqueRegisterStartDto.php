<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

/** Exactly one of email (signup), resetToken, reauthTicket (change password), upgradeTicket selects the context. */
class OpaqueRegisterStartDto
{
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public ?string $email = null;

    #[Assert\Length(max: 255)]
    public ?string $resetToken = null;

    #[Assert\Length(max: 2048)]
    public ?string $reauthTicket = null;

    #[Assert\Length(max: 2048)]
    public ?string $upgradeTicket = null;

    /** Blinded element (32 bytes) as base64url */
    #[Assert\NotBlank]
    #[Assert\Length(max: 256)]
    public string $registrationRequest = '';
}
