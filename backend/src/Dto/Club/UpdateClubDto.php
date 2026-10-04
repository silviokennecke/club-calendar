<?php

declare(strict_types=1);

namespace App\Dto\Club;

use Symfony\Component\Validator\Constraints as Assert;

class UpdateClubDto
{
    #[Assert\Length(min: 1, max: 255)]
    public ?string $name = null;

    #[Assert\Length(min: 1)]
    #[Assert\Timezone(zone: \DateTimeZone::ALL_WITH_BC)]
    public ?string $timezone = null;
}
