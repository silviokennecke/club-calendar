<?php

declare(strict_types=1);

namespace App\Enum;

enum HolidaySource: string
{
    case ICS = 'ics';
    case OPENHOLIDAYS = 'openholidays';
}
