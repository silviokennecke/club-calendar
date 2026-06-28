<?php
declare(strict_types=1);

namespace App\EventListener;

use App\Entity\Location;
use Doctrine\ORM\Event\PostUpdateEventArgs;
use Doctrine\ORM\Event\PreUpdateEventArgs;
use Doctrine\ORM\Events;
use Doctrine\Bundle\DoctrineBundle\Attribute\AsEntityListener;
use Symfony\Contracts\Cache\CacheInterface;

#[AsEntityListener(event: Events::preUpdate, entity: Location::class)]
#[AsEntityListener(event: Events::postUpdate, entity: Location::class)]
class LocationMapCacheInvalidator
{
    /** @var string[] */
    private array $pendingIds = [];

    public function __construct(private readonly CacheInterface $mapImagesCache) {}

    public function preUpdate(Location $location, PreUpdateEventArgs $args): void
    {
        if ($args->hasChangedField('latitude') || $args->hasChangedField('longitude')) {
            $this->pendingIds[] = $location->getId();
        }
    }

    public function postUpdate(Location $location, PostUpdateEventArgs $args): void
    {
        $id = $location->getId();
        if (!in_array($id, $this->pendingIds, true)) {
            return;
        }

        $this->mapImagesCache->delete('location_' . $id);
        $this->pendingIds = array_values(array_filter($this->pendingIds, fn($i) => $i !== $id));
    }
}
