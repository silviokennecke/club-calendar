<?php

declare(strict_types=1);

namespace App\Dto\Club;

use Symfony\Component\Validator\Constraints as Assert;

class AddMemberDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    public string $email = '';
}
