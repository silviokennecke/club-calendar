<?php

declare(strict_types=1);

namespace App\Opaque;

/** The client MAC (KE3) did not verify. */
final class AuthenticationFailedException extends OpaqueException
{
}
