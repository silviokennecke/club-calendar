<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\S3ClientFactory;
use App\Storage\S3KeyRotator;
use App\Storage\StorageConfig;
use League\Flysystem\AwsS3V3\AwsS3V3Adapter;
use League\Flysystem\Filesystem;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Lock\Store\InMemoryStore;

/**
 * Real S3 / MinIO over https. Skipped unless TEST_S3_ENDPOINT, TEST_S3_BUCKET, TEST_S3_KEY and TEST_S3_SECRET are set
 * (TEST_S3_INSECURE_TLS=1 accepts a self-signed certificate; REQUIRE_S3_TESTS=1 turns the skip into a failure). The bucket must exist; objects under a random prefix
 * are created and removed.
 */
class S3IntegrationTest extends TestCase
{
    private string $endpoint;
    private string $bucket;
    private string $prefix;

    protected function setUp(): void
    {
        $env = static fn (string $n): string => (string) (getenv($n) ?: '');
        if ('' === $env('TEST_S3_ENDPOINT') || '' === $env('TEST_S3_BUCKET') || '' === $env('TEST_S3_KEY') || '' === $env('TEST_S3_SECRET')) {
            // CI sets REQUIRE_S3_TESTS: a missing provider must fail there, not skip
            '' !== $env('REQUIRE_S3_TESTS') ? $this->fail('TEST_S3_* not set but REQUIRE_S3_TESTS is') : $this->markTestSkipped('TEST_S3_* not set');
        }
        $this->endpoint = $env('TEST_S3_ENDPOINT');
        $this->bucket = $env('TEST_S3_BUCKET');
        $this->prefix = 'phpunit-'.bin2hex(random_bytes(4));
    }

    private function client(string $sseKey, bool $sse = true): \Aws\S3\S3Client
    {
        $factory = new S3ClientFactory($this->endpoint, 'us-east-1', (string) getenv('TEST_S3_KEY'), (string) getenv('TEST_S3_SECRET'), true, $sseKey);

        return $factory->build($sse, '1' === getenv('TEST_S3_INSECURE_TLS') ? ['http' => ['verify' => false]] : []);
    }

    public function testSseCRoundTripAndRotation(): void
    {
        $old = base64_encode(random_bytes(32));
        $new = base64_encode(random_bytes(32));

        $oldFs = new Filesystem(new AwsS3V3Adapter($this->client($old), $this->bucket, $this->prefix));
        $oldFs->write('a.txt', 'secret A');
        $oldFs->write('dir/b.txt', 'secret B');
        $plainFs = new Filesystem(new AwsS3V3Adapter($this->client('', false), $this->bucket, $this->prefix));
        $plainFs->write('plain.txt', 'plain');
        $oldFs->copy('a.txt', 'a-copy.txt');
        $this->assertSame('secret A', $oldFs->read('a-copy.txt'));

        // The old key cannot read the plain object, no key cannot read encrypted ones
        $this->assertFalse($this->canRead($plainFs, 'a.txt'));

        $config = new StorageConfig(StorageConfig::S3, $this->endpoint, $this->bucket, $this->prefix, $new, $old.',plain');
        $rotator = new S3KeyRotator($this->client('', false), new LockFactory(new InMemoryStore()), $config, new NullLogger());
        $result = $rotator->rotate(false);
        $this->assertFalse($result->failed());
        $this->assertSame(4, $result->rotated);

        $newFs = new Filesystem(new AwsS3V3Adapter($this->client($new), $this->bucket, $this->prefix));
        $this->assertSame('secret A', $newFs->read('a.txt'));
        $this->assertSame('secret B', $newFs->read('dir/b.txt'));
        $this->assertSame('plain', $newFs->read('plain.txt'));
        $this->assertFalse($this->canRead($oldFs, 'a.txt'));
        $this->assertSame(4, $rotator->rotate(false)->current);

        $newFs->deleteDirectory('');
    }

    private function canRead(Filesystem $fs, string $path): bool
    {
        try {
            $fs->read($path);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
