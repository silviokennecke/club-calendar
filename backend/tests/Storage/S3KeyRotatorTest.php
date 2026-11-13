<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\S3KeyRotator;
use App\Storage\StorageConfig;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\Lock\LockFactory;
use Symfony\Component\Lock\Store\InMemoryStore;

class S3KeyRotatorTest extends TestCase
{
    private string $new;
    private string $old;
    private string $older;
    private FakeS3 $s3;

    protected function setUp(): void
    {
        $this->new = base64_encode(random_bytes(32));
        $this->old = base64_encode(random_bytes(32));
        $this->older = base64_encode(random_bytes(32));
        $this->s3 = new FakeS3();
    }

    private function md5(string $b64): string
    {
        return base64_encode(md5((string) base64_decode($b64), true));
    }

    private function rotator(string $previous, string $source = StorageConfig::S3, string $current = '', ?LockFactory $locks = null, string $prefix = ''): S3KeyRotator
    {
        $config = new StorageConfig($source, 'https://s3.test', 'bkt', $prefix, '' === $current ? $this->new : $current, $previous);

        return new S3KeyRotator($this->s3->client(false), $locks ?? new LockFactory(new InMemoryStore()), $config, new NullLogger());
    }

    public function testAllCurrentChangesNothing(): void
    {
        $this->s3->put('a', 'A', $this->md5($this->new));
        $this->s3->put('b', 'B', $this->md5($this->new));
        $r = $this->rotator($this->old)->rotate(false);
        $this->assertSame([2, 0, 2], [$r->checked, $r->rotated, $r->current]);
        $this->assertFalse($r->failed());
        $this->assertCount(0, array_filter($this->s3->log, static fn ($e) => 'CopyObject' === $e['op']));
    }

    public function testRotatesOldAndPlainObjectsAndKeepsContent(): void
    {
        $this->s3->put('cur', 'C', $this->md5($this->new));
        $this->s3->put('x/old', 'O', $this->md5($this->old));
        $this->s3->put('older', 'OO', $this->md5($this->older));
        $this->s3->put('plain file', 'P', null);
        $r = $this->rotator($this->old.', '.$this->older.',plain')->rotate(false);

        $this->assertSame([4, 3, 1], [$r->checked, $r->rotated, $r->current]);
        $this->assertFalse($r->failed());
        foreach (['cur', 'x/old', 'older', 'plain file'] as $key) {
            $this->assertSame($this->md5($this->new), $this->s3->md5Of($key), $key);
        }
        $this->assertSame('P', $this->s3->objects['plain file']['body']);

        // Copy carried the old key as source and the new one as target; the plain one had no source key
        $copies = array_values(array_filter($this->s3->log, static fn ($e) => 'CopyObject' === $e['op']));
        $this->assertCount(3, $copies);
        foreach ($copies as $c) {
            $this->assertSame('COPY', $c['headers']['x-amz-metadata-directive']);
            $this->assertSame($this->md5($this->new), $c['headers']['x-amz-server-side-encryption-customer-key-md5']);
        }
        $plain = array_values(array_filter($copies, static fn ($e) => 'plain file' === $e['key']))[0];
        $this->assertArrayNotHasKey('x-amz-copy-source-server-side-encryption-customer-key', $plain['headers']);

        // Second run is a no-op
        $again = $this->rotator($this->old.',plain')->rotate(false);
        $this->assertSame([0, 4], [$again->rotated, $again->current]);
    }

    public function testUnreadableObjectIsReportedByKeyOnly(): void
    {
        $this->s3->put('ok', 'A', $this->md5($this->old));
        $this->s3->put('lost', 'B', $this->md5($this->older));
        $r = $this->rotator($this->old)->rotate(false);
        $this->assertTrue($r->failed());
        $this->assertSame(['lost'], $r->unreadable);
        $this->assertSame(1, $r->rotated);
        $this->assertSame($this->md5($this->older), $this->s3->md5Of('lost'));
    }

    public function testPlainObjectIsUnreadableWithoutPlainEntry(): void
    {
        $this->s3->put('p', 'x', null);
        $r = $this->rotator($this->old)->rotate(false);
        $this->assertSame(['p'], $r->unreadable);
    }

    public function testDryRunChangesNothing(): void
    {
        $this->s3->put('o', 'x', $this->md5($this->old));
        $r = $this->rotator($this->old)->rotate(true);
        $this->assertSame(1, $r->rotated);
        $this->assertSame($this->md5($this->old), $this->s3->md5Of('o'));
        $this->assertCount(0, array_filter($this->s3->log, static fn ($e) => 'CopyObject' === $e['op']));
    }

    public function testHeldLockSkips(): void
    {
        $locks = new LockFactory(new InMemoryStore());
        $held = $locks->createLock('storage-rotate-key');
        $this->assertTrue($held->acquire());
        $this->s3->put('o', 'x', $this->md5($this->old));
        $r = $this->rotator($this->old, locks: $locks)->rotate(false);
        $this->assertNotNull($r->skipped);
        $this->assertSame($this->md5($this->old), $this->s3->md5Of('o'));
        $this->assertSame([], $this->s3->log);
        $held->release();
    }

    public function testNoOpWithoutPreviousOrWithLocalSource(): void
    {
        $this->s3->put('o', 'x', $this->md5($this->old));
        $this->assertNotNull($this->rotator('')->rotate(false)->skipped);
        $this->assertNotNull($this->rotator($this->old, StorageConfig::LOCAL)->rotate(false)->skipped);
        $this->assertNotNull($this->rotator($this->old, current: ' ')->rotate(false)->skipped);
        $this->assertSame([], $this->s3->log);
    }

    public function testOversizedObjectIsReportedNotCopied(): void
    {
        $this->s3->put('big', 'x', $this->md5($this->old));
        $this->s3->sizes['big'] = S3KeyRotator::MAX_COPY_SIZE + 1;
        $r = $this->rotator($this->old)->rotate(false);
        $this->assertSame(['big'], $r->tooLarge);
        $this->assertTrue($r->failed());
    }

    public function testOnlyPrefixIsTouched(): void
    {
        $this->s3->put('files/a', 'x', $this->md5($this->old));
        $this->s3->put('other/b', 'y', $this->md5($this->old));
        $r = $this->rotator($this->old, prefix: '/files/')->rotate(false);
        $this->assertSame(1, $r->rotated);
        $this->assertSame($this->md5($this->old), $this->s3->md5Of('other/b'));
    }

    public function testNoKeyMaterialInConfigOrErrors(): void
    {
        $bad = new StorageConfig(StorageConfig::S3, '', 'bkt', '', $this->new, 'not-a-key');
        try {
            $bad->previousKeys();
            $this->fail();
        } catch (\Throwable $e) {
            $this->assertStringContainsString('S3_SSE_C_KEY_PREVIOUS', $e->getMessage());
            $this->assertStringNotContainsString('not-a-key', $e->getMessage());
        }
    }
}
