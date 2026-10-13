<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use App\Validator\PasswordPolicy;
use Symfony\Component\Validator\Constraints as Assert;

class RegisterDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\NotBlank]
    #[Assert\Email]
    public string $email = '';

    #[PasswordPolicy]
    public string $password = '';

    public ?string $language = null;
}
