<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\TrustedHostsEnvVarProcessor;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\Exception\RuntimeException;

class TrustedHostsEnvVarProcessorTest extends TestCase
{
    /** @param array<string, string> $env */
    private static function regex(array $env): string
    {
        return (new TrustedHostsEnvVarProcessor())->getEnv('trusted_hosts', 'TRUSTED_HOSTS', static fn (string $n): string => $env[$n] ?? '');
    }

    private static function hostMatches(string $regex, string $host): bool
    {
        return 1 === preg_match('{'.$regex.'}i', $host);
    }

    public function testAllowsTheHostsOfTheConfiguredUrlsAndLoopbackOnly(): void
    {
        $regex = self::regex([
            'APP_URL' => 'https://cal.example.com',
            'FRONTEND_URL' => 'https://cal.example.com',
            'BACKEND_URL' => 'https://api.example.com:8443/base',
        ]);

        foreach (['cal.example.com', 'CAL.example.com', 'api.example.com', 'localhost', '127.0.0.1', '[::1]'] as $host) {
            $this->assertTrue(self::hostMatches($regex, $host), $host);
        }
        // Dots are literal, no prefix/suffix tricks.
        foreach (['calXexample.com', 'cal.example.com.attacker.test', 'evilcal.example.com', 'example.com', ''] as $host) {
            $this->assertFalse(self::hostMatches($regex, $host), $host);
        }
    }

    public function testExtraHostsFromTheVariable(): void
    {
        $regex = self::regex(['APP_URL' => 'https://cal.example.com', 'FRONTEND_URL' => 'https://cal.example.com', 'BACKEND_URL' => 'https://cal.example.com', 'TRUSTED_HOSTS' => ' www.example.com , ,alt.example.org']);

        $this->assertTrue(self::hostMatches($regex, 'www.example.com'));
        $this->assertTrue(self::hostMatches($regex, 'alt.example.org'));
        $this->assertFalse(self::hostMatches($regex, 'wwwXexample.com'));
    }

    public function testRejectsAnUrlWithoutHost(): void
    {
        $this->expectException(RuntimeException::class);
        self::regex(['APP_URL' => 'not-a-url', 'FRONTEND_URL' => 'https://a.test', 'BACKEND_URL' => 'https://a.test']);
    }
}
