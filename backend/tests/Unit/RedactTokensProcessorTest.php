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
}
