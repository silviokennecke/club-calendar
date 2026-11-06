<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Logging\RedactTokensProcessor;
use Monolog\Level;
use Monolog\LogRecord;
use PHPUnit\Framework\TestCase;

class RedactTokensProcessorTest extends TestCase
{
    public function testSecretsInQueryStringsAreRedactedInMessageAndContext(): void
    {
        $secret = bin2hex(random_bytes(16));
        $record = new LogRecord(
            new \DateTimeImmutable(),
            'request',
            Level::Info,
            "Matched route for /api/auth/verify-new-email?token=$secret",
            ['request_uri' => "https://api.example/api/auth/oauth/google/link?ticket=$secret&x=1", 'nested' => ['uri' => "/feed/1?secret=$secret"]],
            ['url' => "/auth/callback?state=$secret&code=$secret#frag"],
        );

        $out = (new RedactTokensProcessor())($record);

        $this->assertSame('Matched route for /api/auth/verify-new-email?token=[redacted]', $out->message);
        $this->assertSame('https://api.example/api/auth/oauth/google/link?ticket=[redacted]&x=1', $out->context['request_uri']);
        $this->assertSame('/feed/1?secret=[redacted]', $out->context['nested']['uri']);
        $this->assertSame('/auth/callback?state=[redacted]&code=[redacted]#frag', $out->extra['url']);
    }

    public function testAccessTokenIsRedactedInMessageContextAndJsonButNotFieldNames(): void
    {
        $record = new LogRecord(
            new \DateTimeImmutable(),
            'app',
            Level::Error,
            'GET https://api.mapbox.com/x?access_token=pk.x&foo=1 failed',
            ['body' => '{"access_token":"pk.x","other":1}', 'nested' => ['u' => 'https://h/p?foo=1&access_token=pk.x']],
            ['plain' => 'https://api.mapbox.com/x?foo=1', 'access_token' => 'kept-as-key-only-for-values'],
        );

        $out = (new RedactTokensProcessor())($record);

        $this->assertSame('GET https://api.mapbox.com/x?access_token=[redacted]&foo=1 failed', $out->message);
        $this->assertSame('{"access_token":"[redacted]","other":1}', $out->context['body']);
        $this->assertSame('https://h/p?foo=1&access_token=[redacted]', $out->context['nested']['u']);
        $this->assertSame('https://api.mapbox.com/x?foo=1', $out->extra['plain']);
        $this->assertArrayHasKey('access_token', $out->extra);
    }

    public function testThrowableWithSecretInChainIsReplacedByRedactedArray(): void
    {
        $previous = new \RuntimeException('HTTP 401 returned for "https://api.mapbox.com/a?access_token=pk.x&foo=1"');
        $e = new \LogicException('outer failed', 7, $previous);
        $record = new LogRecord(new \DateTimeImmutable(), 'app', Level::Error, 'm', ['exception' => $e, 'path' => 'p']);

        $out = (new RedactTokensProcessor())($record);

        $ex = $out->context['exception'];
        $this->assertIsArray($ex);
        $this->assertSame(\LogicException::class, $ex['class']);
        $this->assertSame('outer failed', $ex['message']);
        $this->assertSame(7, $ex['code']);
        $this->assertStringContainsString('foo=1', $ex['previous']['message']);
        $this->assertStringContainsString('access_token=[redacted]', $ex['previous']['message']);
        $this->assertStringNotContainsString('pk.x', json_encode($out->context, JSON_THROW_ON_ERROR));
    }

    public function testThrowableWithoutSecretIsLeftIntact(): void
    {
        $e = new \RuntimeException('plain https://h/p?foo=1');
        $out = (new RedactTokensProcessor())(new LogRecord(new \DateTimeImmutable(), 'app', Level::Error, 'm', ['exception' => $e]));

        $this->assertSame($e, $out->context['exception']);
    }
}
