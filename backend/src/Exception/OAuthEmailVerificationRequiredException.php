<?php

declare(strict_types=1);

namespace App\Exception;

/**
 * An SSO sign-in came from a provider that does not prove the e-mail address (Microsoft) and the account
 * has not confirmed the address yet. The confirmation code was mailed; no session is issued until the
 * code was entered.
 */
class OAuthEmailVerificationRequiredException extends \RuntimeException
{
    public function __construct(public readonly string $email)
    {
        parent::__construct('The e-mail address must be verified before signing in');
    }
}
