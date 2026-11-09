<?php

declare(strict_types=1);

namespace App\Opaque;

/** A received protocol message is malformed (length, invalid or identity element). */
final class InvalidMessageException extends OpaqueException
{
}
