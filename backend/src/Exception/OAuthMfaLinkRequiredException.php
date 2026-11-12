<?php

declare(strict_types=1);

namespace App\Exception;

/**
 * A verified provider login would be linked by e-mail to an existing account that has MFA enforced.
 * That would hand a session to whoever controls the mailbox, so the user must sign in with password
 * and MFA and link the provider from the profile instead.
 */
class OAuthMfaLinkRequiredException extends \RuntimeException
{
}
