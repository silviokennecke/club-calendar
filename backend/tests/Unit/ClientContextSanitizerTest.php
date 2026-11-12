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
    public function testHostileUserAgentsYieldInertShortText(string $ua): void
    {
        $browser = UserAgentSummary::browser($ua);
        if (null !== $browser) {
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9 ._-]{1,20}$/', $browser);
            $this->assertDoesNotMatchRegularExpression('/[:\/@<>%]/', $browser);
        }
        $context = new ClientContext('203.0.113.5', $browser);
        $this->assertTrue(null === $context->browser || strlen($context->browser) <= 20);
    }

    public function testBrowserIsStrippedCollapsedAndCut(): void
    {
        $this->assertSame('evil.example restore', ClientContextSanitizer::browser("\u{202E}evil\u{200B}.example  ://\t restore"));
        $this->assertNull(ClientContextSanitizer::browser('://<>@%'));
        $this->assertSame(20, strlen((string) ClientContextSanitizer::browser(str_repeat('a', 100))));
        $this->assertSame('httpsevil.examplerest', ClientContextSanitizer::browser('https://evil.example/rest', 21));
    }

    public function testVersionIsKeptWhenFamilyIsShortened(): void
    {
        $out = ClientContextSanitizer::browserWithVersion('A very long browser family name', '126');
        $this->assertLessThanOrEqual(20, strlen((string) $out));
        $this->assertStringEndsWith(' 126', (string) $out);
        $this->assertSame('Chrome 126', ClientContextSanitizer::browserWithVersion('Chrome', '126'));
        $this->assertSame('Chrome', ClientContextSanitizer::browserWithVersion('Chrome', null));
        $this->assertSame('Chrome 12', ClientContextSanitizer::browserWithVersion('Chrome', "1\u{200B}2"));
        // an absurdly long "version" is dropped instead of eating the family
        $this->assertSame('Chrome', ClientContextSanitizer::browserWithVersion('Chrome', str_repeat('9', 30)));
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
        $this->assertSame('Visit httpsevil.exam', $c->browser);
        $this->assertSame('iBerlini', $c->city);
        $this->assertNull($c->country);
    }
}
