<?php

declare(strict_types=1);

namespace App\Service;

use League\Flysystem\FilesystemOperator;
use Psr\Cache\CacheItemPoolInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * The GeoLite2 City file: the master copy lives in the file storage (objects `geoip/GeoLite2-City.<token>.mmdb` plus the
 * pointer `geoip/current` holding the token), every node keeps a local copy under the cache directory because the
 * Reader needs a real file. The token is cached; a matching token means no storage call. Local copies are versioned
 * files, never overwritten, so processes that still map an older one are not disturbed.
 */
class GeoIpDatabase
{
    public const string POINTER = 'geoip/current';
    private const string OBJECT_PREFIX = 'geoip/GeoLite2-City.';
    private const string CACHE_KEY = 'geoip_token';
    private const int TOKEN_TTL = 3600;
    private const int MISSING_TTL = 60;
    private const int OLD_FILE_GRACE = 600;

    public function __construct(
        #[Autowire(service: 'app.storage', lazy: true)]
        private readonly FilesystemOperator $storage,
        #[Autowire(service: 'cache.app')]
        private readonly CacheItemPoolInterface $cache,
        #[Autowire('%kernel.cache_dir%/geoip')]
        private readonly string $localDir,
        private readonly LoggerInterface $logger,
    ) {
    }

    /** Stores a validated local file as the new version and refreshes the cached token. */
    public function publish(string $file): void
    {
        $token = bin2hex(random_bytes(8));
        $in = fopen($file, 'rb');
        if (false === $in) {
            throw new \RuntimeException('Cannot read the database file.');
        }
        try {
            $this->storage->writeStream(self::object($token), $in);
        } finally {
            fclose($in);
        }
        // the pointer is the switch: readers never see a half-written object under it
        $this->storage->write(self::POINTER, $token);

        $this->remember($token, self::TOKEN_TTL);
        $this->pruneStorage($token);
    }

    /** Unix time of the last publish, null when the storage holds none. */
    public function storedAt(): ?int
    {
        try {
            return $this->storage->fileExists(self::POINTER) ? $this->storage->lastModified(self::POINTER) : null;
        } catch (\Throwable $e) {
            $this->logger->warning('GeoIP storage unavailable', ['exception' => $e::class]);

            return null;
        }
    }

    /** Path of an up-to-date local copy (fetched from the storage when needed), null when none is available. */
    public function localPath(): ?string
    {
        try {
            $token = $this->currentToken();
        } catch (\Throwable $e) {
            $this->logger->warning('GeoIP storage unavailable', ['exception' => $e::class]);

            return $this->localCurrent()[1];
        }
        if (null === $token) {
            return $this->localCurrent()[1];
        }

        [$local, $path] = $this->localCurrent();
        if ($local === $token) {
            return $path;
        }

        return $this->fetch($token) ?? $path;
    }

    /** @return array{0: ?string, 1: ?string} token and path of the local copy, if complete */
    public function localCurrent(): array
    {
        $token = @file_get_contents($this->localDir.'/current');
        if (false === $token || 1 !== preg_match('/^[0-9a-f]{16}$/', $token) || !is_file($this->localFile($token))) {
            return [null, null];
        }

        return [$token, $this->localFile($token)];
    }

    private function currentToken(): ?string
    {
        $item = $this->cache->getItem(self::CACHE_KEY);
        if ($item->isHit()) {
            $value = $item->get();

            return '' === $value ? null : $value;
        }
        $token = $this->storage->fileExists(self::POINTER) ? trim($this->storage->read(self::POINTER)) : '';
        if ('' !== $token && 1 !== preg_match('/^[0-9a-f]{16}$/', $token)) {
            throw new \RuntimeException('Invalid GeoIP pointer.');
        }
        $this->remember($token, '' === $token ? self::MISSING_TTL : self::TOKEN_TTL);

        return '' === $token ? null : $token;
    }

    private function remember(string $token, int $ttl): void
    {
        $item = $this->cache->getItem(self::CACHE_KEY);
        $item->set($token)->expiresAfter($ttl);
        $this->cache->save($item);
    }

    private function fetch(string $token): ?string
    {
        if (!is_dir($this->localDir) && !@mkdir($this->localDir, 0775, true) && !is_dir($this->localDir)) {
            $this->logger->warning('GeoIP: cannot create the local directory');

            return null;
        }
        $lock = fopen($this->localDir.'/.lock', 'c');
        if (false === $lock) {
            return null;
        }
        $tmp = null;
        try {
            // another process is already downloading: keep serving the old copy (or none) meanwhile
            if (!flock($lock, LOCK_EX | LOCK_NB)) {
                return null;
            }
            [$local, $path] = $this->localCurrent();
            if ($local === $token) {
                return $path;
            }

            $tmp = $this->localDir.'/.dl-'.bin2hex(random_bytes(4));
            $out = fopen($tmp, 'wb');
            $in = $this->storage->readStream(self::object($token));
            try {
                if (false === $out || false === stream_copy_to_stream($in, $out) || 0 === (int) filesize($tmp)) {
                    throw new \RuntimeException('Download from storage failed.');
                }
            } finally {
                fclose($in);
                if (false !== $out) {
                    fclose($out);
                }
            }
            if (!rename($tmp, $this->localFile($token))) {
                throw new \RuntimeException('Cannot move the database into place.');
            }
            $tmp = null;
            $switch = $this->localDir.'/.current-'.bin2hex(random_bytes(4));
            file_put_contents($switch, $token);
            rename($switch, $this->localDir.'/current');
            $this->pruneLocal($token);

            return $this->localFile($token);
        } catch (\Throwable $e) {
            $this->logger->warning('GeoIP: fetching the database from storage failed', ['exception' => $e::class]);

            return null;
        } finally {
            if (null !== $tmp) {
                @unlink($tmp);
            }
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** Older versions stay for a grace period (open mappings stay valid on POSIX anyway). */
    private function pruneLocal(string $current): void
    {
        foreach (glob($this->localDir.'/GeoLite2-City.*.mmdb') ?: [] as $file) {
            if ($file !== $this->localFile($current) && time() - (int) filemtime($file) > self::OLD_FILE_GRACE) {
                @unlink($file);
            }
        }
    }

    /** Keeps the new and the previous object: a node that just read the old pointer can still download. */
    private function pruneStorage(string $current): void
    {
        try {
            $objects = [];
            foreach ($this->storage->listContents('geoip', false) as $item) {
                if ($item->isFile() && str_starts_with($item->path(), self::OBJECT_PREFIX) && $item->path() !== self::object($current)) {
                    $objects[$item->path()] = (int) $item->lastModified();
                }
            }
            arsort($objects);
            foreach (array_slice(array_keys($objects), 1) as $path) {
                $this->storage->delete($path);
            }
        } catch (\Throwable $e) {
            $this->logger->warning('GeoIP: cleaning up old storage objects failed', ['exception' => $e::class]);
        }
    }

    private static function object(string $token): string
    {
        return self::OBJECT_PREFIX.$token.'.mmdb';
    }

    private function localFile(string $token): string
    {
        return $this->localDir.'/GeoLite2-City.'.$token.'.mmdb';
    }
}
