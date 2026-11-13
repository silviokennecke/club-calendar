<?php

declare(strict_types=1);

namespace App\Service;

enum GeoIpUpdateStatus
{
    case NotConfigured;
    case Skipped;
    case Updated;
    case Failed;
}
