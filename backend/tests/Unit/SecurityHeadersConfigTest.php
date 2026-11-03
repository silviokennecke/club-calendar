<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Drift guard for the security headers (audit M4). They live in two web-server configs that PHPUnit cannot run:
 * `backend/public/.htaccess` (Apache) and `docker/Caddyfile`. Both must carry the same CSP and header set, and
 * the SPA shell must not need inline scripts (the CSP has no `'unsafe-inline'` for scripts).
 */
class SecurityHeadersConfigTest extends TestCase
{
    private const string HTACCESS = __DIR__.'/../../public/.htaccess';
    private const string CADDYFILE = __DIR__.'/../../../docker/Caddyfile';
    private const string INDEX_HTML = __DIR__.'/../../../frontend/index.html';

    private static function read(string $file): string
    {
        self::assertFileExists($file);
        $content = file_get_contents($file);
        self::assertIsString($content);

        return $content;
    }

    private static function header(string $config, string $name): string
    {
        $quoted = preg_quote($name, '/');
        $matched = preg_match('/^\s*(?:Header always set(?:ifempty)? )?\??'.$quoted.' "([^"]*)"/m', $config, $m);
        self::assertSame(1, $matched, "Header $name is missing");

        return $m[1];
    }

    /** @return array<string, string> directive => value */
    private static function directives(string $csp): array
    {
        $result = [];
        foreach (array_filter(array_map('trim', explode(';', $csp))) as $part) {
            [$name, $value] = array_pad(explode(' ', $part, 2), 2, '');
            $result[$name] = $value;
        }

        return $result;
    }

    public function testCspIsIdenticalInApacheAndCaddy(): void
    {
        self::assertSame(
            self::header(self::read(self::HTACCESS), 'Content-Security-Policy'),
            self::header(self::read(self::CADDYFILE), 'Content-Security-Policy'),
        );
    }

    public function testCspIsStrict(): void
    {
        $d = self::directives(self::header(self::read(self::CADDYFILE), 'Content-Security-Policy'));

        self::assertSame("'self'", $d['default-src']);
        self::assertSame("'self'", $d['script-src'], 'no inline/eval scripts, no third-party script hosts');
        self::assertStringNotContainsString("'unsafe-inline'", implode(' ', $d), 'no inline styles or scripts');
        self::assertMatchesRegularExpression(
            "/^'self'( 'sha256-[A-Za-z0-9+\\/]{43}=')*$/",
            $d['style-src'],
            'style-src: own files plus exact hashes of fixed library stylesheets only',
        );
        self::assertSame("'none'", $d['frame-ancestors']);
        self::assertSame("'none'", $d['object-src']);
        self::assertSame("'self'", $d['base-uri']);
        self::assertSame("'self'", $d['form-action']);
        self::assertStringNotContainsString('*', $d['connect-src']);
        self::assertStringNotContainsString("'unsafe-eval'", implode(' ', $d));
        self::assertStringNotContainsString('http:', implode(' ', $d));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('configs')]
    public function testRequiredHeadersAreSetInBothConfigs(string $file): void
    {
        $config = self::read($file);

        self::assertSame('nosniff', self::header($config, 'X-Content-Type-Options'));
        self::assertSame('DENY', self::header($config, 'X-Frame-Options'));
        self::assertMatchesRegularExpression('/(?:setifempty )?\??Referrer-Policy "strict-origin-when-cross-origin"/', $config);
        self::assertSame('same-origin', self::header($config, 'Cross-Origin-Opener-Policy'));
        $permissions = self::header($config, 'Permissions-Policy');
        foreach (['camera', 'microphone', 'geolocation', 'payment', 'usb'] as $feature) {
            self::assertStringContainsString($feature.'=()', $permissions);
        }
    }

    /** @return iterable<string, array{string}> */
    public static function configs(): iterable
    {
        yield 'htaccess' => [self::HTACCESS];
        yield 'caddyfile' => [self::CADDYFILE];
    }

    public function testFeedsKeepNoReferrerAndHstsIsConditional(): void
    {
        $htaccess = self::read(self::HTACCESS);
        $caddy = self::read(self::CADDYFILE);

        self::assertMatchesRegularExpression('/\(api\/\)\?feed\/.*\n\s*Header always set Referrer-Policy "no-referrer"/', $htaccess);
        self::assertStringContainsString('Header always setifempty Referrer-Policy', $htaccess, 'general default must not override the feed rule');
        self::assertMatchesRegularExpression('/@feed path \/feed\/\* \/api\/feed\/\*\n\s*header @feed Referrer-Policy no-referrer/', $caddy);
        self::assertMatchesRegularExpression('/Strict-Transport-Security "max-age=\d+" "expr=/', $htaccess, 'HSTS only for HTTPS requests');
        self::assertDoesNotMatchRegularExpression('/^\s*Strict-Transport-Security/m', $caddy, 'Caddy sits behind the TLS terminator');
    }

    public function testApacheDeniesSecretFiles(): void
    {
        $htaccess = self::read(self::HTACCESS);

        self::assertStringContainsString('(env|pem|log)', $htaccess);
    }

    public function testSpaShellHasNoInlineStyle(): void
    {
        $html = self::read(self::INDEX_HTML);

        self::assertDoesNotMatchRegularExpression('/<style\b/i', $html);
        self::assertDoesNotMatchRegularExpression('/\sstyle\s*=/i', $html, 'style attributes are blocked by style-src');
    }

    public function testSpaShellHasNoInlineScript(): void
    {
        $html = self::read(self::INDEX_HTML);

        $count = preg_match_all('/<script\b([^>]*)>(.*?)<\/script>/is', $html, $matches, PREG_SET_ORDER);
        self::assertGreaterThan(0, $count);
        foreach ($matches as $script) {
            self::assertMatchesRegularExpression('/\bsrc="/', $script[1], 'every script must be external');
            self::assertSame('', trim($script[2]), 'no inline script body');
        }
        self::assertDoesNotMatchRegularExpression('/\son[a-z]+\s*=/i', $html, 'no inline event handlers');
        self::assertStringContainsString('/theme-init.js', $html);
    }
}
