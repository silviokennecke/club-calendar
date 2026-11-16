<?php

declare(strict_types=1);

namespace App\Logging;

use Monolog\Formatter\NormalizerFormatter;
use Monolog\LogRecord;

/** Normalizes context for OTLP attributes: no duplicate stack traces (the exception.* attributes carry one), capped strings. */
final class OtelLogFormatter extends NormalizerFormatter
{
    private const int MAX_STRING = 1000;

    public function __construct()
    {
        parent::__construct();
        $this->setMaxNormalizeDepth(4);
    }

    public function format(LogRecord $record): mixed
    {
        $formatted = parent::format($record);
        unset($formatted['context']['exception']['trace']);

        return self::cap($formatted);
    }

    public static function cap(mixed $value): mixed
    {
        if (\is_string($value)) {
            return mb_strlen($value) > self::MAX_STRING ? mb_substr($value, 0, self::MAX_STRING).'…' : $value;
        }
        if (\is_array($value)) {
            return array_map(self::cap(...), $value);
        }

        return $value;
    }
}
