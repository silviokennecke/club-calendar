<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Command\GeoIpDebugCommand;
use App\Security\ClientContextResolver;
use App\Security\HeaderCountryLocationResolver;
use App\Security\LocationResolver;
use App\Security\MaxMindLocationResolver;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\Console\Application;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;

class GeoIpDebugCommandTest extends TestCase
{
    private const string FIXTURE = __DIR__.'/../fixtures/geoip/GeoIP2-City-Test.mmdb';

    private RequestStack $stack;

    protected function tearDown(): void
    {
        Request::setTrustedProxies([], Request::HEADER_X_FORWARDED_FOR);
    }

    private function tester(LocationResolver $resolver, string $header = 'CF-IPCountry', string $key = '', string $db = '/nonexistent/db.mmdb'): CommandTester
    {
        $this->stack = new RequestStack();
        $command = new GeoIpDebugCommand(new ClientContextResolver($this->stack, $resolver), $resolver, $this->stack, $key, $db, $header);
        $app = new Application();
        $app->addCommand($command);

        return new CommandTester($app->find('app:geoip:debug'));
    }

    private static function flat(string $s): string
    {
        return (string) preg_replace('/\s+/', ' ', $s);
    }

    public function testParsesHeadersAtFirstColon(): void
    {
        self::assertSame(
            ['CF-IPCountry' => 'DE', 'X-Test' => 'a: b'],
            GeoIpDebugCommand::parseHeaders(['CF-IPCountry:DE', ' X-Test :  a: b ']),
        );
    }

    public function testInvalidHeaderFails(): void
    {
        $t = $this->tester(new HeaderCountryLocationResolver('CF-IPCountry'));
        self::assertSame(Command::FAILURE, $t->execute(['ip' => '10.0.0.1', '-H' => ['no-colon']]));
        self::assertStringContainsString('Invalid header', $t->getDisplay());
        self::assertSame(Command::FAILURE, $t->execute(['ip' => '10.0.0.1', '-H' => [': x']]));
        self::assertSame(Command::FAILURE, $t->execute(['ip' => 'not-an-ip']));
    }

    public function testHeaderResolverWithTrustedProxy(): void
    {
        Request::setTrustedProxies(['10.0.0.1'], Request::HEADER_X_FORWARDED_FOR);
        $t = $this->tester(new HeaderCountryLocationResolver('CF-IPCountry'));
        self::assertSame(Command::SUCCESS, $t->execute(['ip' => '10.0.0.1', '-H' => ['CF-IPCountry: de', 'X-Forwarded-For: 203.0.113.9']]));
        $out = $t->getDisplay();
        self::assertStringContainsString('Location found', $out);
        self::assertMatchesRegularExpression('/Country\s+DE/', $out);
        self::assertMatchesRegularExpression('/Client IP as the app sees it\s+203\.0\.113\.9/', $out);
        self::assertMatchesRegularExpression('/Is a trusted proxy\s+yes/', $out);
        self::assertNull($this->stack->getCurrentRequest());
    }

    public function testHeaderResolverWithUntrustedProxyIsIgnored(): void
    {
        Request::setTrustedProxies(['10.0.0.1'], Request::HEADER_X_FORWARDED_FOR);
        $t = $this->tester(new HeaderCountryLocationResolver('CF-IPCountry'));
        $t->execute(['ip' => '198.51.100.7', '-H' => ['CF-IPCountry: DE']]);
        $out = $t->getDisplay();
        self::assertStringContainsString('Nothing found', $out);
        self::assertStringContainsString('not one of the trusted proxies', self::flat($out));
    }

    public function testNoTrustedProxiesConfigured(): void
    {
        $t = $this->tester(new HeaderCountryLocationResolver('CF-IPCountry'));
        $t->execute(['ip' => '10.0.0.1', '-H' => ['CF-IPCountry: DE']]);
        self::assertStringContainsString('no trusted proxies are configured', self::flat($t->getDisplay()));
    }

    public function testHeaderOffAndIgnoredValues(): void
    {
        $t = $this->tester(new HeaderCountryLocationResolver(''), '');
        $t->execute(['ip' => '10.0.0.1']);
        self::assertStringContainsString('CLIENT_COUNTRY_HEADER is empty', $t->getDisplay());

        Request::setTrustedProxies(['10.0.0.1'], Request::HEADER_X_FORWARDED_FOR);
        $t = $this->tester(new HeaderCountryLocationResolver('CF-IPCountry'));
        $t->execute(['ip' => '10.0.0.1']);
        self::assertStringContainsString('has no "CF-IPCountry" header', $t->getDisplay());
        $t->execute(['ip' => '10.0.0.1', '-H' => ['CF-IPCountry: XX']]);
        self::assertStringContainsString('not a usable country code', $t->getDisplay());
    }

    public function testMaxMindPrivateIpAndMissingFile(): void
    {
        $resolver = new MaxMindLocationResolver('/nonexistent/db.mmdb', new NullLogger());
        $t = $this->tester($resolver, '', 'secret-key');
        $t->execute(['ip' => '192.168.1.1']);
        $out = $t->getDisplay();
        self::assertStringContainsString('private or reserved', $out);
        self::assertStringContainsString('MaxMind GeoLite2', $out);
        self::assertStringNotContainsString('secret-key', $out);

        $t->execute(['ip' => '81.2.69.142']);
        self::assertStringContainsString('missing or not readable', self::flat($t->getDisplay()));
    }

    public function testMaxMindWithFixtureDatabase(): void
    {
        $resolver = new MaxMindLocationResolver(self::FIXTURE, new NullLogger());
        $t = $this->tester($resolver, '', 'k', self::FIXTURE);
        $t->execute(['ip' => '81.2.69.142']);
        $out = $t->getDisplay();
        self::assertStringContainsString('Location found', $out);
        self::assertMatchesRegularExpression('/Country\s+GB/', $out);
    }
}
