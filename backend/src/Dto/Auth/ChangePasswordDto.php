<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use App\Validator\PasswordPolicy;

class ChangePasswordDto
{
    #[PasswordPolicy]
    public string $newPassword = '';
}
