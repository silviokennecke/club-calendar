<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class OpaqueReauthFinishDto
{
    #[Assert\NotBlank]
    #[Assert\Length(max: 64)]
    public string $purpose = '';

    /** Sealed state blob from reauth/start */
    #[Assert\NotBlank]
    #[Assert\Length(max: 2048)]
    public string $loginState = '';

    /** KE3 (64 bytes) as base64url */
    #[Assert\NotBlank]
    #[Assert\Length(max: 256)]
    public string $finishLoginRequest = '';
}
