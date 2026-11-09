<?php

declare(strict_types=1);

namespace App\Opaque;

/** A stored (server-side) record is unreadable; distinct from bad client input ({@see InvalidMessageException}). */
final class CorruptRecordException extends OpaqueException
{
}
