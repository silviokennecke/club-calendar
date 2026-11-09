<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class OpaqueLoginStartDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';

    /** KE1 (96 bytes) as base64url */
    #[Assert\NotBlank]
    #[Assert\Length(max: 256)]
    public string $startLoginRequest = '';
}
