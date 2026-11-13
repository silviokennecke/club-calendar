<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Service\AppBranding;
use App\Service\IndexHtmlTitle;
use App\Service\IndexHtmlTitleCacheWarmer;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

class IndexHtmlTitleTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/idx-title-'.bin2hex(random_bytes(4));
        mkdir($this->dir.'/public', 0777, true);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/{,public/}{*,.*}', GLOB_BRACE) ?: [] as $f) {
            is_file($f) && unlink($f);
        }
        @rmdir($this->dir.'/public');
        @rmdir($this->dir);
    }

    private function svc(string $name, string $tpl = '<html><head><title>Club Calendar</title></head></html>'): IndexHtmlTitle
    {
        if ('' !== $tpl) {
            file_put_contents($this->dir.'/index.html.tpl', $tpl);
        }

        return new IndexHtmlTitle(new AppBranding($name), $this->dir.'/index.html.tpl', $this->dir.'/public/index.html');
    }

    private function out(): string
    {
        return (string) file_get_contents($this->dir.'/public/index.html');
    }

    public function testEscapesName(): void
    {
        $this->svc('A & "B" <i>')->apply();
        $this->assertStringContainsString('<title>A &amp; &quot;B&quot; &lt;i&gt;</title>', $this->out());
    }

    public function testCapsAtSixtyAndDefaults(): void
    {
        $this->svc(str_repeat('x', 80))->apply();
        $this->assertStringContainsString('<title>'.str_repeat('x', 60).'</title>', $this->out());
        $this->svc('')->apply();
        $this->assertStringContainsString('<title>Club Calendar</title>', $this->out());
    }

    public function testIdempotentAndNoTempFilesLeft(): void
    {
        $s = $this->svc('Verein');
        $s->apply();
        $first = $this->out();
        $s->apply();
        $this->assertSame($first, $this->out());
        $this->assertSame([], glob($this->dir.'/public/.index.html.*'));
    }

    public function testMarkerMissingOrAmbiguousFails(): void
    {
        foreach (['<title>Other</title>', '<title>Club Calendar</title><title>Club Calendar</title>'] as $tpl) {
            try {
                $this->svc('X', $tpl)->apply();
                $this->fail('expected exception');
            } catch (\RuntimeException) {
                $this->assertFileDoesNotExist($this->dir.'/public/index.html');
            }
        }
    }

    public function testMissingTemplateAndUnwritableTargetFail(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->svc('X', '')->apply();
    }

    public function testWriteFailureThrows(): void
    {
        $this->svc('X');
        $s = new IndexHtmlTitle(new AppBranding('X'), $this->dir.'/index.html.tpl', $this->dir.'/missing/index.html');
        $this->expectException(\RuntimeException::class);
        $s->apply();
    }

    public function testWarmerNeverThrowsAndSkipsWithoutTemplate(): void
    {
        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects($this->once())->method('warning');

        $none = new IndexHtmlTitleCacheWarmer($this->svc('X', ''), $logger);
        $this->assertSame([], $none->warmUp('/x'));
        $this->assertFileDoesNotExist($this->dir.'/public/index.html');

        $broken = new IndexHtmlTitleCacheWarmer($this->svc('X', 'no marker'), $logger);
        $this->assertSame([], $broken->warmUp('/x'));
        $this->assertTrue($broken->isOptional());
    }
}
