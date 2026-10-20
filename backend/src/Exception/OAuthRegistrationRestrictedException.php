<?php

declare(strict_types=1);

namespace App\Exception;

/** An SSO sign-in would create a new account, but registration is restricted to invited addresses. */
class OAuthRegistrationRestrictedException extends \RuntimeException
{
    public function __construct()
    {
        parent::__construct('Registration is restricted to invited addresses');
    }
}
