<?php
declare(strict_types=1);

namespace App\DependencyInjection;

use Psr\Cache\CacheItemPoolInterface;

interface CachePoolAwareInterface
{
    public function setCache(CacheItemPoolInterface $cache): void;
}
