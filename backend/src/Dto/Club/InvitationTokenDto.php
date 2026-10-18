<?php

declare(strict_types=1);

namespace App\Dto\Club;

use Symfony\Component\Validator\Constraints as Assert;

class InvitationTokenDto
{
    #[Assert\NotBlank]
    #[Assert\Length(max: 128)]
    public string $token = '';
}
