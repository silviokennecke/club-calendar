<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\HttpFoundation\Request;

interface LocationResolver
{
    public function resolve(Request $request): Location;
}
