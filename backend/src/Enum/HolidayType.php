<?php

declare(strict_types=1);

namespace App\Enum;

enum HolidayType: string
{
    case PUBLIC = 'public';
    case SCHOOL = 'school';
    case OTHER = 'other';
}
