<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use App\Validator\PasswordPolicy;
use Symfony\Component\Validator\Constraints as Assert;

class ResetPasswordDto
{
    #[Assert\NotBlank]
    #[Assert\Length(max: 255)]
    public string $token = '';

    #[PasswordPolicy]
    public string $password = '';
}
