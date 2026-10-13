<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use App\Validator\PasswordPolicy;
use Symfony\Component\Validator\Constraints as Assert;

class ChangePasswordDto
{
    // Checked against the stored password (an SSO-only account has none: 409 no_password).
    #[Assert\Length(max: 4096)]
    public string $currentPassword = '';

    #[PasswordPolicy]
    public string $newPassword = '';
}
