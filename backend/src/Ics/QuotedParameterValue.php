<?php

declare(strict_types=1);

namespace App\Ics;

use Eluceo\iCal\Presentation\Component\Property\Value;

/**
 * Property parameter value as an RFC 5545 section 3.1 quoted string: control characters (CR, LF, tab, ...)
 * are replaced by a space, the double quote (not allowed inside a quoted parameter) by a single quote, so
 * the value can never end its quotes, start a new parameter/value or a new content line.
 */
final class QuotedParameterValue extends Value
{
    public function __construct(private readonly string $value)
    {
    }

    public function __toString(): string
    {
        $clean = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $this->value) ?? '';
        // invalid UTF-8 makes the /u pattern fail: fall back to a byte-wise strip
        if ('' === $clean && '' !== $this->value) {
            $clean = preg_replace('/[\x00-\x1F\x7F]+/', ' ', $this->value) ?? '';
        }

        return '"'.str_replace('"', "'", trim($clean)).'"';
    }
}
