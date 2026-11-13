<?php

declare(strict_types=1);

namespace App\Tests\Storage;

use League\Flysystem\FilesystemOperator;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Filesystem\Filesystem as SymfonyFilesystem;

class LocalStorageTest extends KernelTestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/cc-storage-'.bin2hex(random_bytes(4));
        putenv('STORAGE_LOCAL_PATH='.$this->dir);
    }

    protected function tearDown(): void
    {
        putenv('STORAGE_LOCAL_PATH');
        putenv('STORAGE_SOURCE');
        (new SymfonyFilesystem())->remove($this->dir);
        parent::tearDown();
    }

    public function testRoundTripThroughContainerStorage(): void
    {
        self::bootKernel();
        $storage = self::getContainer()->get('app.storage');
        $this->assertInstanceOf(FilesystemOperator::class, $storage);
        $storage->write('club/1/a.txt', 'hello');
        $this->assertTrue($storage->fileExists('club/1/a.txt'));
        $this->assertSame('hello', $storage->read('club/1/a.txt'));
        $this->assertFileExists($this->dir.'/club/1/a.txt');
        $storage->delete('club/1/a.txt');
        $this->assertFalse($storage->fileExists('club/1/a.txt'));
    }

    public function testCheckCommandOnLocalStorage(): void
    {
        $kernel = self::bootKernel();
        $t = new CommandTester((new Application($kernel))->find('app:storage:check'));
        $this->assertSame(0, $t->execute([]));
        $this->assertStringContainsString('local files', $t->getDisplay());
        $this->assertStringContainsString('Storage works', $t->getDisplay());
        $this->assertSame([], glob($this->dir.'/.storage-check/*'));
    }

    public function testRotateKeyIsNoOpOnLocalStorage(): void
    {
        putenv('S3_SSE_C_KEY='.base64_encode(random_bytes(32)));
        putenv('S3_SSE_C_KEY_PREVIOUS=plain');
        try {
            $kernel = self::bootKernel();
            $t = new CommandTester((new Application($kernel))->find('app:storage:rotate-key'));
            $this->assertSame(0, $t->execute([]));
            $this->assertStringContainsString('Nothing to do', $t->getDisplay());
        } finally {
            putenv('S3_SSE_C_KEY');
            putenv('S3_SSE_C_KEY_PREVIOUS');
        }
    }

    public function testUnknownSourceFailsWithClearMessage(): void
    {
        putenv('STORAGE_SOURCE=ftp');
        $kernel = self::bootKernel();
        $t = new CommandTester((new Application($kernel))->find('app:storage:check'));
        $this->expectExceptionMessageMatches('/STORAGE_SOURCE must be "storage.local" or "storage.s3", got "ftp"/');
        $t->execute([]);
    }

    public function testS3SourceWithoutBucketFailsCheckConcisely(): void
    {
        putenv('STORAGE_SOURCE=storage.s3');
        try {
            $kernel = self::bootKernel();
            $t = new CommandTester((new Application($kernel))->find('app:storage:check'));
            $this->assertSame(1, $t->execute([]));
            $this->assertStringContainsString('S3_BUCKET is not set', $t->getDisplay());
            $this->assertStringNotContainsString('AWS_', $t->getDisplay());
        } finally {
            putenv('STORAGE_SOURCE');
        }
    }

    public function testS3SourceWithBadKeyFailsCheckWithoutLeakingIt(): void
    {
        putenv('STORAGE_SOURCE=storage.s3');
        putenv('S3_BUCKET=bkt');
        putenv('S3_ENDPOINT=https://s3.test');
        putenv('S3_SSE_C_KEY=bad-key-value');
        try {
            $kernel = self::bootKernel();
            $t = new CommandTester((new Application($kernel))->find('app:storage:check'));
            $this->assertSame(1, $t->execute([]));
            $this->assertStringContainsString('exactly 32', $t->getDisplay());
            $this->assertStringNotContainsString('bad-key-value', $t->getDisplay());
            $this->assertStringContainsString('SSE-C: on', $t->getDisplay());
        } finally {
            foreach (['STORAGE_SOURCE', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_SSE_C_KEY'] as $v) {
                putenv($v);
            }
        }
    }
}
