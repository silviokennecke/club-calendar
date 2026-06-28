<?php
declare(strict_types=1);

namespace App\Service\Map;

interface MapImageProviderInterface
{
    public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string;
}
