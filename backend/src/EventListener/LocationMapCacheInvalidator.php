<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Entity\Location;
use App\Service\Map\MapCacheKeyHelper;
use Doctrine\Bundle\DoctrineBundle\Attribute\AsEntityListener;
use Doctrine\ORM\Event\PreUpdateEventArgs;
use Doctrine\ORM\Events;
use Symfony\Contracts\Cache\CacheInterface;

#[AsEntityListener(event: Events::preUpdate, entity: Location::class)]
#[AsEntityListener(event: Events::postUpdate, entity: Location::class)]
class LocationMapCacheInvalidator
{
    /** @var array<string, array{lat: float, lng: float}> */
    private array $pendingCoords = [];

    public function __construct(
        private readonly CacheInterface $mapImagesCache,
        private readonly int $imageZoom,
        private readonly int $imageWidth,
        private readonly int $imageHeight,
    ) {
    }

    public function preUpdate(Location $location, PreUpdateEventArgs $args): void
    {
        if (
            ($args->hasChangedField('latitude') || $args->hasChangedField('longitude'))
            && null !== $location->getLatitude()
            && null !== $location->getLongitude()
        ) {
            $this->pendingCoords[$location->getId()] = [
                'lat' => $location->getLatitude(),
                'lng' => $location->getLongitude(),
            ];
        }
    }

    public function postUpdate(Location $location): void
    {
        $id = $location->getId();
        if (!isset($this->pendingCoords[$id])) {
            return;
        }

        $coords = $this->pendingCoords[$id];
        unset($this->pendingCoords[$id]);

        $key = MapCacheKeyHelper::forMapImage(
            $coords['lng'],
            $coords['lat'],
            $this->imageZoom,
            $this->imageWidth,
            $this->imageHeight,
        );
        $this->mapImagesCache->delete($key);
    }
}
