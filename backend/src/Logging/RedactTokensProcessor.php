<?php

declare(strict_types=1);

namespace App\Logging;

use Monolog\Attribute\AsMonologProcessor;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;

/**
 * One-time links carry their secret in the query (`?token=` of the confirmation and reset links, `?ticket=`
 * of the SSO link start, `?secret=` of private feeds, tokens of the SSO callback, `link_proof` of the
 * SSO link redirect). The router logs the
 * request URI ("Matched route"), which ends up in the log whenever the request also logs an error.
 * This processor replaces such values in messages and context with "[redacted]".
 * The Mapbox token (`access_token`, the only way Mapbox accepts it) sits in outgoing URLs that HTTP client
 * exceptions put into their message. A Throwable in the context cannot be rewritten, so one that carries a
 * secret anywhere in its chain is replaced by an array (class, message, code, location, trace, previous).
 */
#[AsMonologProcessor]
final class RedactTokensProcessor implements ProcessorInterface
{
    private const string KEYS = 'access_token|refresh_token|token|secret|mfaToken|setupToken|challengeToken|backupCode|otpauthUri|password|newPassword|currentPassword|client_secret';
    // query strings and form bodies (also at the start of a body); indexed backupCodes[0]= / %5B0%5D= / []=
    private const string PATTERN = '/((?:^|[?&\s])(?:token|ticket|secret|refresh_token|code|state|link_proof|access_token|mfaToken|setupToken|challengeToken|password|newPassword|currentPassword|backupCodes?(?:%5B\d*%5D|\[\d*\])?|otpauthUri)=)[^&#\s"\']+/i';
    // JSON, plain and double-encoded (\"key\":\"value\"); the value ends at the closing quote
    private const string JSON_PATTERN = '/("(?:'.self::KEYS.')"\s*:\s*")(?:[^"\\\\]|\\\\.)*/i';
    private const string JSON_ESCAPED_PATTERN = '/(\\\\"(?:'.self::KEYS.')\\\\"\s*:\s*\\\\")(?:[^"\\\\]|\\\\(?!"))*/i';
    // "backupCodes": ["a","b"] (whole array, also escaped)
    private const string JSON_LIST_PATTERN = '/(\\\\?"backupCodes\\\\?"\s*:\s*)\[[^\]]*\]/i';
    // MFA codes under "code": 6 to 10 digits (grouped or not) or a backup code (xxxx-xxxx-xxxx / 12 Crockford characters); error codes stay readable
    private const string CODE_VALUE = '(?:\d{3}[ -]?\d{3,7}|[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}|[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{12})';
    private const string JSON_CODE_PATTERN = '/("code"\s*:\s*\\\\?"?)'.self::CODE_VALUE.'(?=[\\\\"\s,}\]]|$)/i';
    private const string JSON_CODE_ESCAPED_PATTERN = '/(\\\\"code\\\\"\s*:\s*\\\\?"?)'.self::CODE_VALUE.'(?=[\\\\"\s,}\]]|$)/i';
    private const string AUTHORIZATION_PATTERN = '/(\bauthorization\b\\\\?["\']?\s*[:=]\s*\\\\?["\']?(?:(?:Bearer|Basic|Token)\s+)?)[^\s"\',;\\\\]+/i';
    private const string BEARER_PATTERN = '/\b(Bearer\s+)[A-Za-z0-9._~+\/=-]{8,}/';
    // TOTP provisioning URIs carry the secret in their query
    private const string OTPAUTH_PATTERN = '/otpauth:\/\/[^\s"\'<>]+/i';
    // keys of context arrays whose value is always masked (a "code" is masked only when it looks like an MFA code)
    private const string SENSITIVE_KEY = '/^(?:'.self::KEYS.'|backupCodes|authorization|ticket|link_proof)$/i';

    public function __invoke(LogRecord $record): LogRecord
    {
        return $record->with(
            message: self::redact($record->message),
            context: self::redactArray($record->context),
            extra: self::redactArray($record->extra),
        );
    }

    /**
     * @param array<mixed> $values
     *
     * @return array<mixed>
     */
    private static function redactArray(array $values): array
    {
        foreach ($values as $key => $value) {
            if (is_string($key) && null !== $value && !is_bool($value) && 1 === preg_match(self::SENSITIVE_KEY, $key)) {
                $values[$key] = '[redacted]';
            } elseif ('code' === $key && (is_string($value) || is_int($value)) && 1 === preg_match('/^'.self::CODE_VALUE.'$/', (string) $value)) {
                $values[$key] = '[redacted]';
            } elseif (is_string($value)) {
                $values[$key] = self::redact($value);
            } elseif ($value instanceof \Throwable) {
                $values[$key] = self::leaks($value) ? self::describe($value) : $value;
            } elseif (is_array($value)) {
                $values[$key] = self::redactArray($value);
            }
        }

        return $values;
    }

    private static function redact(string $value): string
    {
        foreach ([
            self::PATTERN, self::JSON_PATTERN, self::JSON_ESCAPED_PATTERN,
            self::JSON_CODE_PATTERN, self::JSON_CODE_ESCAPED_PATTERN, self::AUTHORIZATION_PATTERN, self::BEARER_PATTERN,
        ] as $pattern) {
            $value = (string) preg_replace($pattern, '$1[redacted]', $value);
        }
        $value = (string) preg_replace(self::JSON_LIST_PATTERN, '$1"[redacted]"', $value);

        return (string) preg_replace(self::OTPAUTH_PATTERN, 'otpauth://[redacted]', $value);
    }

    private static function leaks(\Throwable $e): bool
    {
        for ($i = 0; null !== $e && $i < 10; ++$i, $e = $e->getPrevious()) {
            if (self::redact($e->getMessage()) !== $e->getMessage() || self::redact($e->getTraceAsString()) !== $e->getTraceAsString()) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, mixed>
     */
    private static function describe(\Throwable $e, int $depth = 0): array
    {
        $out = [
            'class' => $e::class,
            'message' => self::redact($e->getMessage()),
            'code' => $e->getCode(),
            'file' => $e->getFile().':'.$e->getLine(),
            'trace' => self::redact($e->getTraceAsString()),
        ];
        if (null !== $e->getPrevious() && $depth < 9) {
            $out['previous'] = self::describe($e->getPrevious(), $depth + 1);
        }

        return $out;
    }
}
