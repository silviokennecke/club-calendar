<?php

declare(strict_types=1);

namespace App\Tests\OAuth;

use App\OAuth\McpScope;
use PHPUnit\Framework\TestCase;

class McpScopeTest extends TestCase
{
    public function testWriteImpliesReadAndOrderIsCanonical(): void
    {
        self::assertSame('mcp:read mcp:write', McpScope::toString(McpScope::parse('mcp:write') ?? []));
        self::assertSame('mcp:read mcp:write', McpScope::toString(McpScope::parse(' mcp:write  mcp:read mcp:write ') ?? []));
        self::assertSame('mcp:read', McpScope::toString(McpScope::parse('mcp:read') ?? []));
    }

    public function testUnknownOrEmptyIsNull(): void
    {
        self::assertNull(McpScope::parse(''));
        self::assertNull(McpScope::parse('   '));
        self::assertNull(McpScope::parse('mcp:read admin'));
    }

    public function testAllows(): void
    {
        self::assertTrue(McpScope::allows([McpScope::Write], McpScope::Read));
        self::assertTrue(McpScope::allows([McpScope::Read], McpScope::Read));
        self::assertFalse(McpScope::allows([McpScope::Read], McpScope::Write));
    }
}
