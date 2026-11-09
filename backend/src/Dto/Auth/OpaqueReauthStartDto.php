<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class OpaqueReauthStartDto
{
    /** Ticket purpose: delete-account | passkey-register | change-email | change-password */
    #[Assert\NotBlank]
    #[Assert\Length(max: 64)]
    public string $purpose = '';

    /** KE1 (96 bytes) as base64url */
    #[Assert\NotBlank]
    #[Assert\Length(max: 256)]
    public string $startLoginRequest = '';
}
