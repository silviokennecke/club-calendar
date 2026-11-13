<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Service\AppBranding;
use PHPUnit\Framework\TestCase;

class AppBrandingTest extends TestCase
{
    public function testUsesConfiguredName(): void
    {
        $this->assertSame('Test Instance', (new AppBranding('Test Instance'))->name());
    }

    public function testTrimsAndStripsControlCharacters(): void
    {
        $this->assertSame('AB', (new AppBranding("  A\x00\r\nB\u{200B}  "))->name());
    }

    public function testEmptyFallsBackToDefault(): void
    {
        $this->assertSame(AppBranding::PROJECT_NAME, (new AppBranding(''))->name());
        $this->assertSame(AppBranding::PROJECT_NAME, (new AppBranding(" \t\x01 "))->name());
    }

    public function testLimitsLength(): void
    {
        $name = (new AppBranding(str_repeat('ä', 100)))->name();
        $this->assertSame(60, mb_strlen($name));
    }
}
