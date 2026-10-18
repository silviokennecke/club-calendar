<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

/** Re-authentication for `DELETE /api/auth/me`: the password, or (accounts without password) the mailed code. */
class DeleteAccountDto
{
    #[Assert\Length(max: 4096)]
    public ?string $password = null;

    #[Assert\Length(max: 32)]
    public ?string $code = null;
}
