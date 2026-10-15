<?php

declare(strict_types=1);

namespace App\Service\Map;

use App\Exception\ApiProblemException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Whether a map service is configured (MAPBOX_TOKEN set). Without it the map routes answer 503: images
 * with a static placeholder (assets/map-unavailable.png), JSON routes with `code: map_unavailable`.
 */
final readonly class MapAvailability
{
    public const string PLACEHOLDER_IMAGE = __DIR__.'/../../../assets/map-unavailable.png';

    public function __construct(
        #[Autowire(env: 'MAPBOX_TOKEN')]
        private string $mapboxToken,
    ) {
    }

    public function isConfigured(): bool
    {
        return '' !== trim($this->mapboxToken);
    }

    public static function unavailable(): ApiProblemException
    {
        return new ApiProblemException(503, 'Map service not configured', 'map_unavailable');
    }
}
