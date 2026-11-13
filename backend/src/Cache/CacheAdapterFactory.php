<?php

declare(strict_types=1);

namespace App\Cache;

use Symfony\Component\Cache\Adapter\AdapterInterface;
use Symfony\Component\Cache\Adapter\FilesystemAdapter;
use Symfony\Component\Cache\Adapter\RedisAdapter;

/**
 * Builds the adapter of every application-level cache pool (cache.app and the pools that follow it)
 * from CACHE_DSN: empty or "filesystem" = files under CACHE_DIR, redis[s]:// / valkey[s]:// = shared Redis.
 * Runs when the pool service is created, so a bad DSN fails at first use, never silently as filesystem.
 */
final class CacheAdapterFactory
{
    public function __construct(
        private readonly string $dsn,
        private readonly string $directory,
        private readonly string $prefix,
    ) {
    }

    public function create(string $namespace, int $defaultLifetime = 0): AdapterInterface
    {
        $dsn = trim($this->dsn);

        if ('' === $dsn || 'filesystem' === $dsn) {
            return new FilesystemAdapter($namespace, $defaultLifetime, $this->directory);
        }

        if (!preg_match('~^(redis|rediss|valkey|valkeys):~', $dsn)) {
            throw new \InvalidArgumentException('Unsupported CACHE_DSN: use "filesystem" or a redis://, rediss://, valkey:// or valkeys:// URL.');
        }

        $prefix = preg_replace('~[^A-Za-z0-9._-]~', '-', $this->prefix);
        $namespace = '' === $prefix ? $namespace : $prefix.'.'.$namespace;

        return new RedisAdapter(RedisAdapter::createConnection($dsn, ['lazy' => true]), $namespace, $defaultLifetime);
    }
}
