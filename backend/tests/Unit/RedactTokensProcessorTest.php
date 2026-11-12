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

    public function testMfaSecretsAreRedacted(): void
    {
        $record = new LogRecord(
            new \DateTimeImmutable(),
            'app',
            Level::Error,
            'POST /api/auth/mfa/verify?mfaToken=abc.def&x=1 otpauth://totp/Club:a@b.c?secret=JBSWY3DP&issuer=Club failed',
            [
                'body' => '{"mfaToken":"t1","setupToken":"t2","challengeToken":"t3","backupCodes":["aaaa-bbbb","cccc-dddd"],"backupCode":"eeee","otpauthUri":"otpauth://totp/x?secret=Z","code":"123456","keep":"visible"}',
                'err' => '{"code":"rate_limited"}',
                'form' => 'a=1&backupCodes[]=x1&setupToken=t9',
            ],
        );

        $out = (new RedactTokensProcessor())($record);
        $all = $out->message.json_encode($out->context);

        foreach (['abc.def', 'JBSWY3DP', 't1', 't2', 't3', 'aaaa-bbbb', 'cccc-dddd', 'eeee', 'secret=Z', '123456', 'x1', 't9'] as $leak) {
            $this->assertStringNotContainsString($leak, $all, $leak);
        }
        $this->assertStringContainsString('"keep":"visible"', $out->context['body']);
        $this->assertSame('{"code":"rate_limited"}', $out->context['err']);
        $this->assertStringContainsString('x=1', $out->message);
    }

    /** @param array<string, mixed> $context */
    private function redact(string $message, array $context = []): LogRecord
    {
        return (new RedactTokensProcessor())(new LogRecord(new \DateTimeImmutable(), 'app', Level::Error, $message, $context));
    }

    public function testBackupAndTotpCodesInRealBodiesAreRedacted(): void
    {
        $bodies = [
            '{"mfaToken":"T0K3N","method":"backup_code","code":"ABCD-EFGH-JKMN"}',
            '{"code":"abcdefghjkmn","method":"backup_code"}',
            '{"code":123456,"method":"totp"}',
            '{"code":"123 456"}',
            '{"code": "1234567890"}',
            'code=ABCD-EFGH-JKMN&method=backup_code',
            'method=totp&code=123456',
            'backupCodes%5B0%5D=aaaa-bbbb-cccc&backupCodes%5B1%5D=dddd-eeee-ffff',
            'x=1&backupCodes[1]=gggg-hhhh-jjjj&backupCodes[]=kkkk-mmmm-nnnn',
            '{\\"mfaToken\\":\\"T0K3N\\",\\"code\\":\\"ABCD-EFGH-JKMN\\",\\"password\\":\\"hunter2hunter2\\"}',
            '{"password":"hunter2hunter2","newPassword":"n3wpassw0rd","currentPassword":"0ldpassw0rd","k":1}',
            'password=hunter2hunter2&newPassword=n3wpassw0rd',
            'Authorization: Bearer eyJhbGciOi.payload.sig',
            '{"headers":{"Authorization":"Bearer eyJhbGciOi.payload.sig"}}',
            'calling with Bearer eyJhbGciOi.payload.sig now',
        ];
        $leaks = ['T0K3N', 'ABCD-EFGH-JKMN', 'abcdefghjkmn', '123456', '123 456', '1234567890', 'aaaa-bbbb-cccc', 'dddd-eeee-ffff', 'gggg-hhhh-jjjj', 'kkkk-mmmm-nnnn', 'hunter2hunter2', 'n3wpassw0rd', '0ldpassw0rd', 'eyJhbGciOi'];
        foreach ($bodies as $body) {
            $out = $this->redact($body, ['body' => $body])->message;
            foreach ($leaks as $leak) {
                $this->assertStringNotContainsString($leak, $out, $body);
            }
        }
        $this->assertStringContainsString('"method":"totp"', $this->redact('{"code":123456,"method":"totp"}')->message);
        $this->assertStringContainsString('method=backup_code', $this->redact('code=ABCD-EFGH-JKMN&method=backup_code')->message);
    }

    public function testStepUpSecretsAreRedactedInQueryJsonFormAndHeaders(): void
    {
        $t = 'abc123.def456_ghi';
        $record = new LogRecord(
            new \DateTimeImmutable(),
            'req',
            Level::Error,
            "GET /x?stepUpToken=$t&confirmationCode=123456&proof=$t&page=2",
            [
                'json' => '{"stepUpToken":"'.$t.'","confirmationCode":"123456","proof":"'.$t.'","ok":1}',
                'escaped' => '{\"stepUpToken\":\"'.$t.'\",\"proof\":\"'.$t.'\"}',
                'form' => "proof=$t&confirmationCode=123456",
                'headers' => "X-Step-Up-Token: $t\r\nAccept: */*",
                'dump' => "x-step-up-token => $t",
                'nested' => ['stepUpToken' => $t, 'confirmationCode' => '123456', 'proof' => $t, 'X-Step-Up-Token' => $t, 'page' => 2],
            ],
        );

        $out = (new RedactTokensProcessor())($record);

        $this->assertSame('GET /x?stepUpToken=[redacted]&confirmationCode=[redacted]&proof=[redacted]&page=2', $out->message);
        $this->assertSame('{"stepUpToken":"[redacted]","confirmationCode":"[redacted]","proof":"[redacted]","ok":1}', $out->context['json']);
        $this->assertStringNotContainsString($t, $out->context['escaped']);
        $this->assertSame('proof=[redacted]&confirmationCode=[redacted]', $out->context['form']);
        $this->assertSame("X-Step-Up-Token: [redacted]\r\nAccept: */*", $out->context['headers']);
        $this->assertSame('x-step-up-token => [redacted]', $out->context['dump']);
        $this->assertSame(['stepUpToken' => '[redacted]', 'confirmationCode' => '[redacted]', 'proof' => '[redacted]', 'X-Step-Up-Token' => '[redacted]', 'page' => 2], $out->context['nested']);
        $this->assertStringNotContainsString($t, json_encode($out->context));
    }

    public function testErrorCodesAndPlainWordsStayReadable(): void
    {
        foreach (['{"code":"rate_limited"}', '{"code":"invalid_mfa_code"}', '{"code":429}', 'rate_limited for user', 'status code=500 retry'] as $text) {
            $out = $this->redact($text)->message;
            if (str_contains($text, 'code=500')) {
                $this->assertStringContainsString('status', $out);

                continue;
            }
            $this->assertSame($text, $out);
        }
    }

    public function testSensitiveKeysAreMaskedInNestedContextArrays(): void
    {
        $out = $this->redact('m', [
            'request' => ['password' => 'hunter2hunter2', 'newPassword' => 'x', 'headers' => ['Authorization' => 'Bearer abc.def.ghi'], 'backupCodes' => ['aaaa-bbbb-cccc'], 'user' => 'alice'],
            'mfaToken' => 't', 'code' => 'ABCD-EFGH-JKMN', 'error' => ['code' => 'rate_limited', 'other' => 7],
        ])->context;

        $this->assertSame('[redacted]', $out['request']['password']);
        $this->assertSame('[redacted]', $out['request']['newPassword']);
        $this->assertSame('[redacted]', $out['request']['headers']['Authorization']);
        $this->assertSame('[redacted]', $out['request']['backupCodes']);
        $this->assertSame('alice', $out['request']['user']);
        $this->assertSame('[redacted]', $out['mfaToken']);
        $this->assertSame('[redacted]', $out['code']);
        $this->assertSame('rate_limited', $out['error']['code']);
        $this->assertSame(7, $out['error']['other']);
    }

    public function testLargeInputsStayFast(): void
    {
        $inputs = [
            str_repeat('a', 1_000_000),
            str_repeat('"password":"', 80_000),
            str_repeat('\\"code\\":\\"', 80_000),
            str_repeat('Authorization: ', 60_000),
            str_repeat('code=1234 ', 100_000),
            '{"code":"'.str_repeat('1', 1_000_000),
            'Bearer '.str_repeat('a', 1_000_000),
            str_repeat('"backupCodes":[', 70_000),
        ];
        foreach ($inputs as $i => $input) {
            $start = microtime(true);
            $this->redact($input);
            $this->assertLessThan(1.0, microtime(true) - $start, "input $i");
            $this->assertSame(PREG_NO_ERROR, preg_last_error(), "input $i");
        }
    }
}
