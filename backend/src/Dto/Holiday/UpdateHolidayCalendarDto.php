<?php

declare(strict_types=1);

namespace App\Dto\Holiday;

use Symfony\Component\Validator\Constraints as Assert;

/** Partial update: null = not sent (unchanged); a sent value has the rules of CreateHolidayCalendarDto. */
class UpdateHolidayCalendarDto
{
    #[Assert\NotBlank(allowNull: true)]
    #[Assert\Length(min: 1, max: 255)]
    public ?string $name = null;

    #[Assert\NotBlank(allowNull: true)]
    #[Assert\Url]
    #[Assert\Length(max: 2048)]
    public ?string $url = null;

    #[Assert\Choice(choices: ['public', 'school', 'other'])]
    public ?string $type = null;
}
