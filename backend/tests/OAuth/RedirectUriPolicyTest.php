<?php

declare(strict_types=1);

namespace App\Tests\OAuth;

use App\OAuth\RedirectUriPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class RedirectUriPolicyTest extends TestCase
{
    /** @return iterable<string, array{string, ?string}> */
    public static function defaultPolicyCases(): iterable
    {
        yield 'claude web' => ['https://claude.ai/api/mcp/auth_callback', 'claude'];
        yield 'claude host case' => ['HTTPS://Claude.AI/api/mcp/auth_callback', 'claude'];
        yield 'claude code localhost' => ['http://localhost:54321/callback', 'claude'];
        yield 'claude code ip' => ['http://127.0.0.1:1234/callback', 'claude'];
        yield 'claude code ipv6' => ['http://[::1]:1234/callback', 'claude'];
        yield 'claude code no port' => ['http://127.0.0.1/callback', 'claude'];
        yield 'openai stable' => ['https://chatgpt.com/connector_platform_oauth_redirect', 'openai'];
        yield 'openai per app' => ['https://chatgpt.com/connector/oauth/abc_DEF-123', 'openai'];
        yield 'gemini cli' => ['http://localhost:49152/oauth/callback', 'gemini'];
        yield 'claude wrong path' => ['https://claude.ai/other', null];
        yield 'claude port' => ['https://claude.ai:444/api/mcp/auth_callback', null];
        yield 'claude suffix host' => ['https://claude.ai.evil.example/api/mcp/auth_callback', null];
        yield 'userinfo' => ['https://claude.ai@evil.example/api/mcp/auth_callback', null];
        yield 'userinfo trick' => ['https://evil.example@claude.ai/api/mcp/auth_callback', null];
        yield 'fragment' => ['https://claude.ai/api/mcp/auth_callback#x', null];
        yield 'query' => ['https://claude.ai/api/mcp/auth_callback?x=1', null];
        yield 'http hosted' => ['http://claude.ai/api/mcp/auth_callback', null];
        yield 'https loopback' => ['https://localhost/callback', null];
        yield 'loopback other path' => ['http://localhost:1/evil', null];
        yield 'openai bad id' => ['https://chatgpt.com/connector/oauth/a/b', null];
        yield 'wildcard' => ['https://*.claude.ai/api/mcp/auth_callback', null];
        yield 'custom scheme' => ['myapp://callback', null];
        yield 'unknown host' => ['https://example.org/cb', null];
        yield 'empty' => ['', null];
    }

    #[DataProvider('defaultPolicyCases')]
    public function testDefaultPolicy(string $uri, ?string $family): void
    {
        $this->assertSame($family, (new RedirectUriPolicy('claude,openai,gemini'))->match($uri));
    }

    public function testOnlyListedFamiliesMatch(): void
    {
        $policy = new RedirectUriPolicy(' Claude , ');
        $this->assertSame('claude', $policy->match('https://claude.ai/api/mcp/auth_callback'));
        $this->assertNull($policy->match('https://chatgpt.com/connector_platform_oauth_redirect'));
        $this->assertNull($policy->match('http://localhost:1/oauth/callback'));
    }

    public function testEmptyListAllowsAnyClientButStaysStrict(): void
    {
        $policy = new RedirectUriPolicy('');
        $this->assertTrue($policy->allowsAnyClient());
        $this->assertSame('*', $policy->match('https://example.org/any/path?x=1'));
        $this->assertSame('*', $policy->match('http://localhost:8123/whatever'));
        $this->assertNull($policy->match('http://example.org/cb'));
        $this->assertNull($policy->match('https://example.org/cb#frag'));
        $this->assertNull($policy->match('https://user@example.org/cb'));
        $this->assertNull($policy->match('https://*.example.org/cb'));
        $this->assertNull($policy->match('javascript:alert(1)'));
    }

    public function testUnknownTokenFailsFast(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new RedirectUriPolicy('claude,grok');
    }
}
