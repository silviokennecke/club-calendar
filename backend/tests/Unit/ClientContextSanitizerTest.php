<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Security\ClientContext;
use App\Security\ClientContextSanitizer;
use App\Security\UserAgentSummary;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ClientContextSanitizerTest extends TestCase
{
    /** @return iterable<string, array{string}> */
    public static function hostile(): iterable
    {
        yield 'url' => ['URGENT account locked https://evil.example/restore?x=1'];
        yield 'url in cfnetwork rule' => ['URGENT: visit https://evil.example/restore now/1.0 CFNetwork/1.0 Darwin/1.0'];
        yield 'html' => ['<script>alert(1)</script><a href="http://e.x">click</a>/5 CFNetwork/1 Darwin/1'];
        yield 'bidi and zero width' => ["\u{202E}evil\u{200B}.example\u{2066}/restore\u{FEFF} CFNetwork/1 Darwin/1"];
        yield 'crlf' => ["Chrome/126\r\nBcc: attacker@evil.example\r\nSubject: x"];
        yield 'long' => [str_repeat('A', 5000).'/7 CFNetwork/1 Darwin/1'];
        yield 'mail and percent' => ['user@evil.example%0d%0a/9 CFNetwork/1 Darwin/1'];
    }

    #[DataProvider('hostile')]
    public function testHostileUserAgentsYieldNullOrKnownBrowser(string $ua): void
    {
        $browser = UserAgentSummary::browser($ua);
        if (null !== $browser) {
            $this->assertMatchesRegularExpression('/^[A-Za-z ]{1,30}( \d{1,3})?$/', $browser);
        }
        $context = new ClientContext('203.0.113.5', $browser, null, null, $ua);
        $this->assertSame($browser, $context->browser);
    }

    public function testDomainLikeNamesAreUnknown(): void
    {
        foreach (['acct-reset.io/1 CFNetwork/1410 Darwin/22', 'www.evil.co/1 CFNetwork/1410 Darwin/22', 'support.example.com/99 CFNetwork/1 Darwin/1'] as $ua) {
            $this->assertNull(UserAgentSummary::browser($ua), $ua);
        }
        foreach (['www.evil.co 1', 'Visit https://evil.example now', 'Chrome 1260', 'Chrome 12.3', 'Unknown 5', '', "Chrome\u{202E} 1"] as $text) {
            $this->assertNull(ClientContextSanitizer::browser($text), $text);
        }
    }

    public function testKnownBrowsersKeepOnlyDigitVersion(): void
    {
        $this->assertSame('Chrome 126', ClientContextSanitizer::browser('Chrome 126'));
        $this->assertSame('Samsung Internet 25', ClientContextSanitizer::knownBrowser('Samsung Internet', '25'));
        $this->assertSame('Chrome Mobile', ClientContextSanitizer::knownBrowser('Chrome Mobile iOS', null));
        $this->assertSame('Chrome', ClientContextSanitizer::knownBrowser('Chrome', '126.1'));
        $this->assertSame('Chrome', ClientContextSanitizer::knownBrowser('Chrome', '1234'));
        $this->assertSame('Chrome', ClientContextSanitizer::knownBrowser('Chrome', "1\u{200B}2"));
        $this->assertNull(ClientContextSanitizer::knownBrowser('Other', '1'));
        $this->assertNull(ClientContextSanitizer::knownBrowser(null));
    }

    public function testRawUserAgentIsCappedAndCleanedForTheLogOnly(): void
    {
        $this->assertSame(512, strlen((string) ClientContextSanitizer::userAgent(str_repeat('a', 5000))));
        $this->assertSame('a b', ClientContextSanitizer::userAgent("a\r\nb"));
        $this->assertNull(ClientContextSanitizer::userAgent(" \n "));
        $ua = 'www.evil.co/1 CFNetwork/1410 Darwin/22';
        $c = new ClientContext('203.0.113.5', UserAgentSummary::browser($ua), null, null, $ua);
        $this->assertSame($ua, $c->userAgent);
        $this->assertNull($c->browser);
    }

    public function testCountryMustBeTwoLetters(): void
    {
        $this->assertSame('DE', ClientContextSanitizer::country(' de '));
        foreach (['', 'DEU', 'D1', 'https://evil', "D\u{200B}E", null] as $bad) {
            $this->assertNull(ClientContextSanitizer::country($bad));
        }
    }

    public function testCityKeepsLettersButNoStructure(): void
    {
        $this->assertSame('Zürich', ClientContextSanitizer::city('Zürich'));
        $this->assertSame('São Paulo', ClientContextSanitizer::city('São  Paulo'));
        $this->assertSame('bevilb.example restore', ClientContextSanitizer::city("<b>evil</b>.example\u{202E} /restore"));
        $this->assertSame(100, mb_strlen((string) ClientContextSanitizer::city(str_repeat('ä', 500))));
        $this->assertNull(ClientContextSanitizer::city('</>'));
    }

    public function testContextSanitizesEveryClientField(): void
    {
        $c = new ClientContext('203.0.113.5', 'Visit https://evil.example now', '<i>Berlin</i>', 'DE; DROP');
        $this->assertNull($c->browser);
        $this->assertSame('iBerlini', $c->city);
        $this->assertNull($c->country);
    }
}
