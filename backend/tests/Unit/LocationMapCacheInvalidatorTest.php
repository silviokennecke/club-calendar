<?php
declare(strict_types=1);

namespace App\Tests\Unit;

use App\Entity\Location;
use App\EventListener\LocationMapCacheInvalidator;
use Doctrine\ORM\Event\PostUpdateEventArgs;
use Doctrine\ORM\Event\PreUpdateEventArgs;
use Doctrine\Persistence\ObjectManager;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\Cache\CacheInterface;

class LocationMapCacheInvalidatorTest extends TestCase
{
    private function makeListener(): array
    {
        $cache    = $this->createMock(CacheInterface::class);
        $listener = new LocationMapCacheInvalidator($cache);
        return [$listener, $cache];
    }

    private function preArgs(bool $latChanged, bool $lngChanged): PreUpdateEventArgs
    {
        $args = $this->createMock(PreUpdateEventArgs::class);
        $args->method('hasChangedField')->willReturnCallback(
            fn(string $f) => ($f === 'latitude' && $latChanged) || ($f === 'longitude' && $lngChanged)
        );
        return $args;
    }

    private function postArgs(Location $location): PostUpdateEventArgs
    {
        return new PostUpdateEventArgs($location, $this->createMock(ObjectManager::class));
    }

    public function testClearsCacheWhenLatitudeChanges(): void
    {
        [$listener, $cache] = $this->makeListener();
        $location = new Location();
        $cache->expects($this->once())->method('delete')->with('location_' . $location->getId());

        $listener->preUpdate($location, $this->preArgs(true, false));
        $listener->postUpdate($location, $this->postArgs($location));
    }

    public function testClearsCacheWhenLongitudeChanges(): void
    {
        [$listener, $cache] = $this->makeListener();
        $location = new Location();
        $cache->expects($this->once())->method('delete')->with('location_' . $location->getId());

        $listener->preUpdate($location, $this->preArgs(false, true));
        $listener->postUpdate($location, $this->postArgs($location));
    }

    public function testDoesNotClearCacheWhenOnlyNameChanges(): void
    {
        [$listener, $cache] = $this->makeListener();
        $location = new Location();
        $cache->expects($this->never())->method('delete');

        $listener->preUpdate($location, $this->preArgs(false, false));
        $listener->postUpdate($location, $this->postArgs($location));
    }

    public function testDoesNotClearCacheIfPreUpdateNeverFired(): void
    {
        [$listener, $cache] = $this->makeListener();
        $location = new Location();
        $cache->expects($this->never())->method('delete');

        $listener->postUpdate($location, $this->postArgs($location));
    }
}
