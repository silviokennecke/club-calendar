<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class ChangeEmailDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 255)]
    public string $email = '';

    #[Assert\Length(max: 4096)]
    public ?string $password = null;

    /** OPAQUE reauth ticket (purpose change-email), instead of the password */
    #[Assert\Length(max: 2048)]
    public ?string $reauthTicket = null;
}
