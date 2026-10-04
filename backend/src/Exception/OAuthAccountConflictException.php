<?php

declare(strict_types=1);

namespace App\Exception;

/**
 * An SSO sign-in names the e-mail address of an existing account, but the provider does not confirm
 * that the address is verified, so the accounts are not linked automatically.
 */
class OAuthAccountConflictException extends \RuntimeException
{
}
