<?php

declare(strict_types=1);

namespace App\Dto\Club;

use Symfony\Component\Validator\Constraints as Assert;

class CreateClubDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\NotBlank]
    #[Assert\Length(min: 1)]
    public string $timezone = 'Europe/Berlin';
}
