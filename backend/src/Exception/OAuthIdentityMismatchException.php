<?php

declare(strict_types=1);

namespace App\Exception;

/** A provider account's stored Microsoft tenant/object id differs from the ones in the ID token: sign-in fails closed. */
class OAuthIdentityMismatchException extends \RuntimeException
{
}
