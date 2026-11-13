<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use App\Storage\SseCKey;
use App\Storage\StorageConfigException;
use Aws\S3\S3Client;
use League\Flysystem\AwsS3V3\AwsS3V3Adapter;
use League\Flysystem\Filesystem;
use PHPUnit\Framework\TestCase;

class SseCTest extends TestCase
{
    private string $raw;
    private string $b64;

    protected function setUp(): void
    {
        $this->raw = random_bytes(32);
        $this->b64 = base64_encode($this->raw);
    }

    /** @param array{headers: array<string, string>} $entry */
    private function assertKey(array $entry, string $prefix, string $raw): void
    {
        $h = $entry['headers'];
        $this->assertSame('AES256', $h[$prefix.'algorithm'] ?? null);
        $this->assertSame(base64_encode($raw), $h[$prefix.'key'] ?? null);
        $this->assertSame(base64_encode(md5($raw, true)), $h[$prefix.'key-md5'] ?? null);
    }

    public function testFlysystemRoundTripSendsKeyOnEveryOperation(): void
    {
        $s3 = new FakeS3();
        $fs = new Filesystem(new AwsS3V3Adapter($s3->client(true, $this->b64), 'bkt', 'pre'));
        $fs->write('a.txt', 'hello');
        $this->assertTrue($fs->fileExists('a.txt'));
        $this->assertSame('hello', $fs->read('a.txt'));
        $fs->copy('a.txt', 'b.txt');
        $this->assertSame('hello', $fs->read('b.txt'));
        $fs->delete('a.txt');

        $seen = [];
        foreach ($s3->log as $entry) {
            if (in_array($entry['op'], ['DeleteObject', 'GetObjectAcl'], true)) {
                continue; // no SSE-C parameters on delete and ACL calls
            }
            $seen[$entry['op']] = true;
            $this->assertKey($entry, 'x-amz-server-side-encryption-customer-', $this->raw);
            if ('CopyObject' === $entry['op']) {
                $this->assertKey($entry, 'x-amz-copy-source-server-side-encryption-customer-', $this->raw);
            }
        }
        $this->assertEqualsCanonicalizing(['PutObject', 'HeadObject', 'GetObject', 'CopyObject'], array_keys($seen));
        $this->assertSame(base64_encode(md5($this->raw, true)), $s3->md5Of('pre/b.txt'));
    }

    public function testMultipartOperationsCarryTheKey(): void
    {
        $s3 = new FakeS3();
        $client = $s3->client(true, $this->b64);
        $calls = [
            'CreateMultipartUpload' => ['Bucket' => 'bkt', 'Key' => 'k'],
            'UploadPart' => ['Bucket' => 'bkt', 'Key' => 'k', 'UploadId' => 'u', 'PartNumber' => 1, 'Body' => 'x'],
            'UploadPartCopy' => ['Bucket' => 'bkt', 'Key' => 'k', 'UploadId' => 'u', 'PartNumber' => 1, 'CopySource' => 'bkt/src'],
        ];
        foreach ($calls as $op => $args) {
            try {
                $client->execute($client->getCommand($op, $args));
            } catch (\Throwable) {
                // the fake does not implement multipart; only the request matters
            }
        }
        $this->assertCount(3, $s3->log);
        foreach ($s3->log as $entry) {
            $this->assertKey($entry, 'x-amz-server-side-encryption-customer-', $this->raw);
        }
        $this->assertKey($s3->log[2], 'x-amz-copy-source-server-side-encryption-customer-', $this->raw);
    }

    public function testNoKeyConfiguredSendsNoHeaders(): void
    {
        $s3 = new FakeS3();
        $fs = new Filesystem(new AwsS3V3Adapter($s3->client(true, ''), 'bkt'));
        $fs->write('a.txt', 'x');
        $fs->read('a.txt');
        foreach ($s3->log as $entry) {
            $this->assertArrayNotHasKey('x-amz-server-side-encryption-customer-key', $entry['headers']);
        }
    }

    public function testExplicitParametersWin(): void
    {
        $s3 = new FakeS3();
        $other = random_bytes(32);
        $client = $s3->client(true, $this->b64);
        $client->putObject(['Bucket' => 'bkt', 'Key' => 'k', 'Body' => 'x', 'SSECustomerAlgorithm' => 'AES256', 'SSECustomerKey' => $other]);
        $this->assertKey($s3->log[0], 'x-amz-server-side-encryption-customer-', $other);
    }

    /** @return iterable<string, array{string}> */
    public static function badKeys(): iterable
    {
        yield 'too short' => [base64_encode('short')];
        yield 'too long' => [base64_encode(str_repeat('a', 33))];
        yield 'not base64' => ['***not base64***'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('badKeys')]
    public function testWrongKeyFailsFastWithoutLeakingIt(string $bad): void
    {
        try {
            (new FakeS3())->client(true, $bad);
            $this->fail('expected an exception');
        } catch (StorageConfigException $e) {
            $this->assertStringContainsString('S3_SSE_C_KEY', $e->getMessage());
            $this->assertStringNotContainsString($bad, $e->getMessage());
            $this->assertStringContainsString('openssl rand -base64 32', $e->getMessage());
        }
    }

    public function testKeyIsRedactedWhenDumped(): void
    {
        $key = SseCKey::fromBase64($this->b64);
        $this->assertStringNotContainsString($this->b64, print_r($key, true));
        $this->assertStringNotContainsString(bin2hex($this->raw), var_export($key->__debugInfo(), true));
        $this->expectException(\LogicException::class);
        serialize($key);
    }

    public function testHttpEndpointIsRefusedByTheSdkWithoutLeakingTheKey(): void
    {
        $factory = new \App\Storage\S3ClientFactory('http://minio.local:9000', 'us-east-1', 'AK', 'SK', true, $this->b64);
        $client = $factory->build(true, ['handler' => new FakeS3()]);
        try {
            $client->putObject(['Bucket' => 'bkt', 'Key' => 'k', 'Body' => 'x']);
            $this->fail('expected an exception');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('HTTPS', $e->getMessage());
            $this->assertStringNotContainsString($this->b64, $e->getMessage());
        }
        $this->assertInstanceOf(S3Client::class, $client);
    }
}
