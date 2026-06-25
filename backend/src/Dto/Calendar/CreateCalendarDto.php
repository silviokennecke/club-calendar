<?php
declare(strict_types=1);

namespace App\Dto\Calendar;

use Symfony\Component\Validator\Constraints as Assert;

class CreateCalendarDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\Length(max: 100)]
    public ?string $timezone = null;
}
