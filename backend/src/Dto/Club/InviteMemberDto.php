<?php

declare(strict_types=1);

namespace App\Dto\Club;

use Symfony\Component\Validator\Constraints as Assert;

class InviteMemberDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';
}
