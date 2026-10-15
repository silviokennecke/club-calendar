<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use App\Validator\PasswordPolicy;
use Symfony\Component\Validator\Constraints as Assert;

class LoginDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';

    #[Assert\NotBlank]
    #[Assert\Length(max: PasswordPolicy::MAX)]
    public string $password = '';
}
