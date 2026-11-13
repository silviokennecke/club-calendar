<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Command\GeoIpUpdateCommand;
use App\Service\GeoIpDatabase;
use App\Service\GeoIpUpdater;
use League\Flysystem\Filesystem;
use League\Flysystem\Local\LocalFilesystemAdapter;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Console\Application;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Filesystem\Filesystem as SymfonyFilesystem;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class GeoIpUpdateCommandTest extends TestCase
{
    private const string FIXTURE = __DIR__.'/../fixtures/geoip/GeoIP2-City-Test.mmdb';

    private string $dir;
    private GeoIpDatabase $database;
    private Filesystem $storage;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/geoip-test-'.bin2hex(random_bytes(4));
        $this->storage = new Filesystem(new LocalFilesystemAdapter($this->dir.'/storage'));
        $this->database = new GeoIpDatabase($this->storage, new ArrayAdapter(), $this->dir.'/local', new NullLogger());
    }

    protected function tearDown(): void
    {
        (new SymfonyFilesystem())->remove([$this->dir, $this->dir.'-src', $this->dir.'-bad']);
    }

    private function storedFiles(): array
    {
        return array_map('basename', glob($this->dir.'/storage/geoip/*') ?: []);
    }

    private function archive(string $innerName = 'GeoLite2-City_20260101/GeoLite2-City.mmdb'): string
    {
        $src = $this->dir.'-src';
        mkdir($src.'/'.dirname($innerName), 0775, true);
        copy(self::FIXTURE, $src.'/'.$innerName);
        $tar = sys_get_temp_dir().'/geoip-arch-'.bin2hex(random_bytes(4)).'.tar';
        $phar = new \PharData($tar);
        $phar->buildFromDirectory($src);
        $phar->compress(\Phar::GZ);
        $content = file_get_contents($tar.'.gz');
        @unlink($tar);
        @unlink($tar.'.gz');
        unlink($src.'/'.$innerName);
        rmdir($src.'/'.dirname($innerName));
        rmdir($src);

        return (string) $content;
    }

    /** @param list<MockResponse>|MockResponse $responses */
    private function tester(MockResponse|array $responses, string $account = '123', string $key = 'k', bool $force = false): CommandTester
    {
        $command = new GeoIpUpdateCommand(new GeoIpUpdater(new MockHttpClient($responses), $account, $key, $this->database));
        $app = new Application();
        $app->addCommand($command);

        return new CommandTester($app->find('app:geoip:update'));
    }

    public function testNoopWithoutLicenseKey(): void
    {
        $tester = $this->tester([], '', '');
        $this->assertSame(Command::SUCCESS, $tester->execute([]));
        $this->assertSame([], $this->storedFiles());
    }

    public function testDownloadsValidatesAndStores(): void
    {
        $response = new MockResponse($this->archive());
        $tester = $this->tester([$response]);
        $this->assertSame(Command::SUCCESS, $tester->execute([]));
        $files = $this->storedFiles();
        $this->assertCount(2, $files);
        $token = $this->storage->read(GeoIpDatabase::POINTER);
        $this->assertSame(md5_file(self::FIXTURE), md5($this->storage->read('geoip/GeoLite2-City.'.$token.'.mmdb')));
        $this->assertStringContainsString('download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz', $response->getRequestUrl());
        $this->assertSame(['Authorization: Basic '.base64_encode('123:k')], array_values(array_filter($response->getRequestOptions()['headers'], static fn ($h) => str_starts_with($h, 'Authorization'))));
    }

    public function testHttpErrorKeepsStoredFile(): void
    {
        $this->database->publish(self::FIXTURE);
        $before = $this->storage->read(GeoIpDatabase::POINTER);
        $tester = $this->tester(new MockResponse('nope', ['http_code' => 401]), force: true);
        $this->assertSame(Command::FAILURE, $tester->execute(['--force' => true]));
        $this->assertSame($before, $this->storage->read(GeoIpDatabase::POINTER));
    }

    public function testInvalidDatabaseIsNotStored(): void
    {
        $this->database->publish(self::FIXTURE);
        $before = $this->storage->read(GeoIpDatabase::POINTER);
        $bad = sys_get_temp_dir().'/geoip-bad-'.bin2hex(random_bytes(4)).'.tar';
        $src = $this->dir.'-bad';
        mkdir($src);
        file_put_contents($src.'/x.mmdb', 'garbage');
        $phar = new \PharData($bad);
        $phar->buildFromDirectory($src);
        $phar->compress(\Phar::GZ);
        $content = (string) file_get_contents($bad.'.gz');
        @unlink($bad);
        @unlink($bad.'.gz');

        $tester = $this->tester(new MockResponse($content));
        $this->assertSame(Command::FAILURE, $tester->execute(['--force' => true]));
        $this->assertSame($before, $this->storage->read(GeoIpDatabase::POINTER));
        $this->assertCount(2, $this->storedFiles());
    }

    public function testFreshFileSkippedUnlessForced(): void
    {
        $this->database->publish(self::FIXTURE);
        $before = $this->storage->read(GeoIpDatabase::POINTER);
        $tester = $this->tester([new MockResponse($this->archive()), new MockResponse($this->archive())]);
        $this->assertSame(Command::SUCCESS, $tester->execute([]));
        $this->assertSame($before, $this->storage->read(GeoIpDatabase::POINTER));

        $this->assertSame(Command::SUCCESS, $tester->execute(['--force' => true]));
        $this->assertNotSame($before, $this->storage->read(GeoIpDatabase::POINTER));
        // new and previous object are kept
        $this->assertCount(3, $this->storedFiles());
    }
}
