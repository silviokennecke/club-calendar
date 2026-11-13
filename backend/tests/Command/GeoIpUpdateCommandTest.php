<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Command\GeoIpUpdateCommand;
use App\Service\GeoIpUpdater;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Application;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class GeoIpUpdateCommandTest extends TestCase
{
    private const string FIXTURE = __DIR__.'/../fixtures/geoip/GeoIP2-City-Test.mmdb';

    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/geoip-test-'.bin2hex(random_bytes(4));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($this->dir);
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
    private function tester(MockResponse|array $responses, string $account = '123', string $key = 'k'): CommandTester
    {
        $command = new GeoIpUpdateCommand(new GeoIpUpdater(new MockHttpClient($responses), $account, $key, $this->dir.'/GeoLite2-City.mmdb'));
        $app = new Application();
        $app->addCommand($command);

        return new CommandTester($app->find('app:geoip:update'));
    }

    public function testNoopWithoutLicenseKey(): void
    {
        $tester = $this->tester([], '', '');
        $this->assertSame(Command::SUCCESS, $tester->execute([]));
        $this->assertFileDoesNotExist($this->dir.'/GeoLite2-City.mmdb');
    }

    public function testDownloadsAndInstallsDatabase(): void
    {
        $response = new MockResponse($this->archive());
        $tester = $this->tester([$response]);
        $this->assertSame(Command::SUCCESS, $tester->execute([]));
        $this->assertFileExists($this->dir.'/GeoLite2-City.mmdb');
        $this->assertSame(md5_file(self::FIXTURE), md5_file($this->dir.'/GeoLite2-City.mmdb'));
        $this->assertSame(['GeoLite2-City.mmdb'], array_map('basename', glob($this->dir.'/*') ?: []));
        $info = $response->getRequestUrl();
        $this->assertStringContainsString('download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz', $info);
        $this->assertSame(['Authorization: Basic '.base64_encode('123:k')], array_values(array_filter($response->getRequestOptions()['headers'], static fn ($h) => str_starts_with($h, 'Authorization'))));
    }

    public function testHttpErrorKeepsOldFile(): void
    {
        mkdir($this->dir, 0775, true);
        file_put_contents($this->dir.'/GeoLite2-City.mmdb', 'old');
        touch($this->dir.'/GeoLite2-City.mmdb', time() - 10 * 86400);
        $tester = $this->tester(new MockResponse('nope', ['http_code' => 401]));
        $this->assertSame(Command::FAILURE, $tester->execute([]));
        $this->assertSame('old', file_get_contents($this->dir.'/GeoLite2-City.mmdb'));
        $this->assertCount(1, glob($this->dir.'/*') ?: []);
    }

    public function testInvalidDatabaseKeepsOldFile(): void
    {
        mkdir($this->dir, 0775, true);
        file_put_contents($this->dir.'/GeoLite2-City.mmdb', 'old');
        touch($this->dir.'/GeoLite2-City.mmdb', time() - 10 * 86400);
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
        unlink($src.'/x.mmdb');
        rmdir($src);

        $tester = $this->tester(new MockResponse($content));
        $this->assertSame(Command::FAILURE, $tester->execute([]));
        $this->assertSame('old', file_get_contents($this->dir.'/GeoLite2-City.mmdb'));
    }

    public function testFreshFileSkippedUnlessForced(): void
    {
        mkdir($this->dir, 0775, true);
        file_put_contents($this->dir.'/GeoLite2-City.mmdb', 'fresh');
        $tester = $this->tester([new MockResponse($this->archive())]);
        $this->assertSame(Command::SUCCESS, $tester->execute([]));
        $this->assertSame('fresh', file_get_contents($this->dir.'/GeoLite2-City.mmdb'));

        $this->assertSame(Command::SUCCESS, $tester->execute(['--force' => true]));
        $this->assertSame(md5_file(self::FIXTURE), md5_file($this->dir.'/GeoLite2-City.mmdb'));
    }
}
