<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\Mfa\BackupCodeGenerator;
use PHPUnit\Framework\TestCase;

class BackupCodeGeneratorTest extends TestCase
{
    public function testGeneratesTenUniqueFormattedCodes(): void
    {
        $codes = (new BackupCodeGenerator())->generate();
        $this->assertCount(10, $codes);
        $this->assertCount(10, array_unique($codes));
        foreach ($codes as $c) {
            $this->assertMatchesRegularExpression('/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/', $c);
        }
    }

    public function testNormalization(): void
    {
        $g = new BackupCodeGenerator();
        $this->assertSame('ABCD1234EF01', $g->normalize(' abcd-1234 ef0l '));
        $this->assertSame('1100', $g->normalize('IlOo'));
        $this->assertSame($g->hash('abcd-1234-ef01'), $g->hash('ABCD 1234 EF01'));
        $this->assertSame($g->hash('0000-0000-0000'), $g->hash('oooo-oooo-oooo'));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $g->hash('abcd-1234-ef01'));
    }

    public function testGeneratedCodeSurvivesRoundTrip(): void
    {
        $g = new BackupCodeGenerator();
        foreach ($g->generate() as $c) {
            $this->assertTrue($g->isWellFormed($c));
            $this->assertSame($g->hash($c), $g->hash(strtolower($c)));
        }
        $this->assertFalse($g->isWellFormed('abc'));
        $this->assertFalse($g->isWellFormed('abcd-1234-ef0!'));
    }
}
