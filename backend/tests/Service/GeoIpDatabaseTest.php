<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Security\MaxMindLocationResolver;
use App\Service\GeoIpDatabase;
use League\Flysystem\Filesystem;
use League\Flysystem\FilesystemOperator;
use League\Flysystem\Local\LocalFilesystemAdapter;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Filesystem\Filesystem as SymfonyFilesystem;
use Symfony\Component\HttpFoundation\Request;

class GeoIpDatabaseTest extends TestCase
{
    private const string FIXTURE = __DIR__.'/../fixtures/geoip/GeoIP2-City-Test.mmdb';

    private string $dir;
    private Filesystem $storage;
    private ArrayAdapter $cache;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/geoip-db-'.bin2hex(random_bytes(4));
        $this->storage = new Filesystem(new LocalFilesystemAdapter($this->dir.'/storage'));
        $this->cache = new ArrayAdapter();
    }

    protected function tearDown(): void
    {
        (new SymfonyFilesystem())->remove($this->dir);
    }

    private function db(?FilesystemOperator $storage = null, ?ArrayAdapter $cache = null): GeoIpDatabase
    {
        return new GeoIpDatabase($storage ?? $this->storage, $cache ?? $this->cache, $this->dir.'/local', new NullLogger());
    }

    /** Counts reads of the storage object and the pointer. */
    private function countingStorage(): object
    {
        return new class($this->storage) extends Filesystem {
            public int $pointerReads = 0;
            public int $streams = 0;

            public function __construct(private readonly FilesystemOperator $inner)
            {
            }

            public function readStream(string $location)
            {
                ++$this->streams;

                return $this->inner->readStream($location);
            }

            public function read(string $location): string
            {
                ++$this->pointerReads;

                return $this->inner->read($location);
            }

            public function fileExists(string $location): bool
            {
                return $this->inner->fileExists($location);
            }

            public function lastModified(string $path): int
            {
                return $this->inner->lastModified($path);
            }

            public function write(string $location, string $contents, array $config = []): void
            {
                $this->inner->write($location, $contents, $config);
            }

            public function writeStream(string $location, $contents, array $config = []): void
            {
                $this->inner->writeStream($location, $contents, $config);
            }

            public function delete(string $location): void
            {
                $this->inner->delete($location);
            }

            public function listContents(string $location, bool $deep = self::LIST_SHALLOW): \League\Flysystem\DirectoryListing
            {
                return $this->inner->listContents($location, $deep);
            }
        };
    }

    public function testPublishStoresObjectAndPointer(): void
    {
        $db = $this->db();
        $db->publish(self::FIXTURE);
        $token = $this->storage->read(GeoIpDatabase::POINTER);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $token);
        $this->assertSame(md5_file(self::FIXTURE), md5($this->storage->read('geoip/GeoLite2-City.'.$token.'.mmdb')));
        $this->assertNotNull($db->storedAt());
    }

    public function testNothingStoredMeansNoPath(): void
    {
        $this->assertNull($this->db()->localPath());
        $this->assertNull($this->db()->storedAt());
    }

    public function testFirstUseFetchesLocalCopyThenFastPath(): void
    {
        $this->db()->publish(self::FIXTURE);
        $storage = $this->countingStorage();
        $db = $this->db($storage);

        $path = $db->localPath();
        $this->assertNotNull($path);
        $this->assertSame(md5_file(self::FIXTURE), md5_file($path));
        $this->assertSame(1, $storage->streams);

        $this->assertSame($path, $db->localPath());
        $this->assertSame($path, $db->localPath());
        $this->assertSame(1, $storage->streams);
        $this->assertSame(0, $storage->pointerReads, 'token came from the cache, no storage call');
    }

    public function testColdCacheReadsPointerOnlyAndKeepsLocalCopy(): void
    {
        $this->db()->publish(self::FIXTURE);
        $path = $this->db()->localPath();

        $storage = $this->countingStorage();
        $db = $this->db($storage, new ArrayAdapter());
        $this->assertSame($path, $db->localPath());
        $this->assertSame(1, $storage->pointerReads);
        $this->assertSame(0, $storage->streams);
        $db->localPath();
        $this->assertSame(1, $storage->pointerReads, 'cache repopulated');
    }

    public function testNewTokenTriggersDownloadAndOldFileStaysReadable(): void
    {
        $updater = $this->db();
        $updater->publish(self::FIXTURE);
        $reader = $this->db();
        $old = $reader->localPath();
        $handle = fopen((string) $old, 'rb');

        $updater->publish(self::FIXTURE);
        $new = $reader->localPath();

        $this->assertNotSame($old, $new);
        $this->assertFileExists((string) $old);
        $this->assertSame(md5_file(self::FIXTURE), md5_file((string) $new));
        $this->assertNotFalse(fread($handle, 16));
        fclose($handle);
        $this->assertSame($new, $reader->localPath());
    }

    public function testOldVersionsAreRemovedAfterGrace(): void
    {
        $updater = $this->db();
        $updater->publish(self::FIXTURE);
        $reader = $this->db();
        $old = (string) $reader->localPath();
        touch($old, time() - 3600);
        $updater->publish(self::FIXTURE);
        $reader->localPath();
        $this->assertFileDoesNotExist($old);
    }

    public function testStorageKeepsCurrentAndPreviousObject(): void
    {
        $db = $this->db();
        $objects = static fn (string $dir): array => glob($dir.'/storage/geoip/GeoLite2-City.*') ?: [];

        $db->publish(self::FIXTURE);
        $db->publish(self::FIXTURE);
        $this->assertCount(2, $objects($this->dir));

        $db->publish(self::FIXTURE);
        $remaining = $objects($this->dir);
        $this->assertCount(2, $remaining);

        $current = trim((string) file_get_contents($this->dir.'/storage/'.GeoIpDatabase::POINTER));
        $this->assertContains($this->dir.'/storage/geoip/GeoLite2-City.'.$current.'.mmdb', $remaining);
    }

    public function testStorageFailureDegradesToLocalCopyOrNothing(): void
    {
        $failing = $this->createStub(FilesystemOperator::class);
        $failing->method('fileExists')->willThrowException(new \RuntimeException('down'));
        $this->assertNull($this->db($failing)->localPath());

        $this->db()->publish(self::FIXTURE);
        $path = $this->db()->localPath();
        $this->assertSame($path, $this->db($failing, new ArrayAdapter())->localPath());
    }

    public function testResolverReopensReaderWhenPathChanges(): void
    {
        $updater = $this->db();
        $updater->publish(self::FIXTURE);
        $resolver = new MaxMindLocationResolver($this->db(), new NullLogger());
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
        $request = Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR' => '81.2.69.142']);
        $this->assertSame('GB', $resolver->resolve($request)->country);

        $updater->publish(self::FIXTURE);
        $this->assertSame('GB', $resolver->resolve($request)->country);
    }

    public function testResolverDegradesWithoutDatabase(): void
    {
        $resolver = new MaxMindLocationResolver($this->db(), new NullLogger());
        $request = Request::create('/', 'GET', [], [], [], ['REMOTE_ADDR' => '81.2.69.142']);
        $this->assertNull($resolver->resolve($request)->country);
    }
}
