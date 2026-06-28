<?php
declare(strict_types=1);

namespace App\Service\Map;

class MapCacheKeyHelper
{
    public static function forGeocoderSuggest(string $query, ?float $lat, ?float $lng, int $limit): string
    {
        return hash('sha256', "suggest:$query:$lat:$lng:$limit");
    }

    public static function forGeocoderReverse(float $lng, float $lat): string
    {
        return hash('sha256', "reverse:$lng:$lat");
    }

    public static function forMapImage(float $lng, float $lat, int $zoom, int $width, int $height): string
    {
        return hash('sha256', "image:$lng:$lat:$zoom:$width:$height");
    }

    public static function forProxyRequest(string $method, string $path, array $queryParams): string
    {
        unset($queryParams['access_token']);
        ksort($queryParams);
        return hash('sha256', "proxy:$method:$path:" . http_build_query($queryParams));
    }
}
