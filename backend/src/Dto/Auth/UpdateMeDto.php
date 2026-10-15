<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class UpdateMeDto
{
    #[Assert\NotBlank(allowNull: true)]
    #[Assert\Length(min: 1, max: 255)]
    public ?string $name = null;

    #[Assert\Length(min: 1, max: 20)]
    public ?string $dateFormat = null;

    #[Assert\Range(min: 0, max: 6)]
    public ?int $firstDayOfWeek = null;

    #[Assert\Choice(choices: ['en', 'de'])]
    public ?string $language = null;

    #[Assert\Length(max: 36)]
    public ?string $lastClubId = null;

    #[Assert\Length(max: 36)]
    public ?string $lastCalendarId = null;
}
