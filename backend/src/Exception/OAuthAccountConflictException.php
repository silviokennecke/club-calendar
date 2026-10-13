<?php

declare(strict_types=1);

namespace App\Exception;

/**
 * An SSO sign-in names the e-mail address of an existing account, but the provider does not confirm
 * that the address is verified, so the accounts are not linked automatically.
 *
 * `unverifiedAtProvider`: the provider's "email_verified" claim is trusted (Google, Apple), but it says
 * the address is not verified there (the user can verify it at the provider and try again). Otherwise
 * the provider's claim is not trusted at all (Microsoft) or the addresses differ beyond letter case.
 */
class OAuthAccountConflictException extends \RuntimeException
{
    public function __construct(string $message, public readonly bool $unverifiedAtProvider = false)
    {
        parent::__construct($message);
    }
}
