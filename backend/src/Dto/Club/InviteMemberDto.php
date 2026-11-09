<?php

declare(strict_types=1);

namespace App\Dto\Club;

use App\Enum\ClubRole;
use Symfony\Component\Validator\Constraints as Assert;

class InviteMemberDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';

    /** member, viewer, editor (default) or admin. */
    #[Assert\Choice(callback: [ClubRole::class, 'values'])]
    public string $role = 'editor';
}
