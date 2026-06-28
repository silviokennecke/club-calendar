<?php
declare(strict_types=1);

namespace App\Tests\Unit;

use App\Entity\Location;
use App\EventListener\LocationMapCacheInvalidator;
use App\Service\Map\MapCacheKeyHelper;
use Doctrine\ORM\Event\PreUpdateEventArgs;
use PHPUnit\Framework\TestCase;
use Symfony\Contracts\Cache\CacheInterface;

class LocationMapCacheInvalidatorTest extends TestCase
{
    private const int ZOOM   = 14;
    private const int WIDTH  = 800;
    private const int HEIGHT = 288;

    private function makeListener(): array
    {
        $cache    = $this->createMock(CacheInterface::class);
        $listener = new LocationMapCacheInvalidator($cache, self::ZOOM, self::WIDTH, self::HEIGHT);
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

    private function locationWithCoords(): Location
    {
        $location = new Location();
        $location->setLatitude(48.137);
        $location->setLongitude(11.575);
        return $location;
    }

    public function testClearsCacheByCoordinateKeyWhenLatitudeChanges(): void
    {
        [$listener, $cache] = $this->makeListener();
        $location    = $this->locationWithCoords();
        $expectedKey = MapCacheKeyHelper::forMapImage(11.575, 48.137, self::ZOOM, self::WIDTH, self::HEIGHT);

        $cache->expects($this->once())->method('delete')->with($expectedKey);

        $listener->preUpdate($location, $this->preArgs(true, false));
        $listener->postUpdate($location);
    }

    public function testClearsCacheByCoordinateKeyWhenLongitudeChanges(): void
    {
        [$listener, $cache] = $this->makeListener();
        $location    = $this->locationWithCoords();
        $expectedKey = MapCacheKeyHelper::forMapImage(11.575, 48.137, self::ZOOM, self::WIDTH, self::HEIGHT);

        $cache->expects($this->once())->method('delete')->with($expectedKey);

        $listener->preUpdate($location, $this->preArgs(false, true));
        $listener->postUpdate($location);
    }

    public function testDoesNotClearCacheWhenOnlyNameChanges(): void
    {
        [$listener, $cache] = $this->makeListener();
        $cache->expects($this->never())->method('delete');

        $listener->preUpdate($this->locationWithCoords(), $this->preArgs(false, false));
        $listener->postUpdate($this->locationWithCoords());
    }

    public function testDoesNotClearCacheIfPreUpdateNeverFired(): void
    {
        [$listener, $cache] = $this->makeListener();
        $cache->expects($this->never())->method('delete');

        $listener->postUpdate($this->locationWithCoords());
    }

    public function testDoesNotClearCacheWhenLocationHasNoCoordinates(): void
    {
        [$listener, $cache] = $this->makeListener();
        $cache->expects($this->never())->method('delete');

        $listener->preUpdate(new Location(), $this->preArgs(true, false));
        $listener->postUpdate(new Location());
    }
}
