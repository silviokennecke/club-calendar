<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Command\BrandingApplyTitleCommand;
use App\Service\AppBranding;
use App\Service\IndexHtmlTitle;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;
use Symfony\Component\Console\Style\SymfonyStyle;

class BrandingApplyTitleCommandTest extends TestCase
{
    private function exec(string $tpl, ?string $content): int
    {
        $dir = sys_get_temp_dir().'/cmd-title-'.bin2hex(random_bytes(4));
        mkdir($dir.'/public', 0777, true);
        if (null !== $content) {
            file_put_contents($dir.'/'.$tpl, $content);
        }
        $svc = new IndexHtmlTitle(new AppBranding('Verein'), $dir.'/index.html.tpl', $dir.'/public/index.html');
        $code = (new BrandingApplyTitleCommand($svc))(new SymfonyStyle(new ArrayInput([]), new BufferedOutput()));
        if (0 === $code) {
            $this->assertStringContainsString('<title>Verein</title>', (string) file_get_contents($dir.'/public/index.html'));
        }
        array_map('unlink', glob($dir.'/{,public/}*', GLOB_BRACE | GLOB_NOSORT) ?: []);
        @rmdir($dir.'/public');
        @rmdir($dir);

        return $code;
    }

    public function testSucceeds(): void
    {
        $this->assertSame(Command::SUCCESS, $this->exec('index.html.tpl', '<title>Club Calendar</title>'));
    }

    public function testFailsWithoutTemplateOrMarker(): void
    {
        $this->assertSame(Command::FAILURE, $this->exec('index.html.tpl', null));
        $this->assertSame(Command::FAILURE, $this->exec('index.html.tpl', '<title>x</title>'));
    }
}
