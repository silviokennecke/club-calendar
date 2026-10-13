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
 */
#[AsMonologProcessor]
final class RedactTokensProcessor implements ProcessorInterface
{
    private const string PATTERN = '/([?&](?:token|ticket|secret|refresh_token|code|state|link_proof)=)[^&#\s"\']+/i';

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
            if (is_string($value)) {
                $values[$key] = self::redact($value);
            } elseif (is_array($value)) {
                $values[$key] = self::redactArray($value);
            }
        }

        return $values;
    }

    private static function redact(string $value): string
    {
        return (string) preg_replace(self::PATTERN, '$1[redacted]', $value);
    }
}
