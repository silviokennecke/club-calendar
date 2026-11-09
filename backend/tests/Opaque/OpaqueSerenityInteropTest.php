<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Wrapper for the live interop run (primary entry: `npm run test:opaque-interop -w frontend`, also a CI step).
 * Excluded from the default run; use `phpunit --group interop`.
 */
#[Group('interop')]
final class OpaqueSerenityInteropTest extends TestCase
{
    public function testSerenityClientAgainstPhpServer(): void
    {
        $root = dirname(__DIR__, 3);
        $node = trim((string) shell_exec('command -v node'));
        if ('' === $node || !is_dir($root.'/node_modules/@serenity-kit/opaque')) {
            self::markTestSkipped('node or @serenity-kit/opaque (npm ci) not available.');
        }

        exec('cd '.escapeshellarg($root.'/frontend').' && '.escapeshellarg($node).' scripts/opaque/interop.mjs 2>&1', $output, $code);

        self::assertSame(0, $code, implode("\n", $output));
    }
}
