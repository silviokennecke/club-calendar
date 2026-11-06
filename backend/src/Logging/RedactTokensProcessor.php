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
    private const string PATTERN = '/([?&](?:token|ticket|secret|refresh_token|code|state|link_proof|access_token)=)[^&#\s"\']+/i';
    private const string JSON_PATTERN = '/("(?:access_token|refresh_token|token|secret)"\s*:\s*")[^"]*/i';

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
        $value = (string) preg_replace(self::PATTERN, '$1[redacted]', $value);

        return (string) preg_replace(self::JSON_PATTERN, '$1[redacted]', $value);
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
