<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class VerifyEmailDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';

    /** The 6 digits from the mail; any other shape is simply a wrong code (checked by the service). */
    #[Assert\NotBlank]
    #[Assert\Length(max: 32)]
    public string $code = '';
}
