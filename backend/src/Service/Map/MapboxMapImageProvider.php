<?php

declare(strict_types=1);

namespace App\Service\Map;

use Symfony\Contracts\HttpClient\HttpClientInterface;

class MapboxMapImageProvider implements MapImageProviderInterface
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly string $mapboxToken,
    ) {
    }

    public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string
    {
        $url = sprintf(
            'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+2563eb(%f,%f)/%f,%f,%d,0/%dx%d?access_token=%s',
            $lng, $lat, $lng, $lat, $zoom, $width, $height, $this->mapboxToken,
        );

        return $this->httpClient->request('GET', $url)->getContent();
    }
}
