<?php
declare(strict_types=1);

namespace App\Dto\Holiday;

use Symfony\Component\Validator\Constraints as Assert;

class CreateHolidayCalendarDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\NotBlank]
    #[Assert\Url]
    #[Assert\Length(max: 2048)]
    public string $url = '';
}
