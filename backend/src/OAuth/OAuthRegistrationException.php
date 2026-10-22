<?php

declare(strict_types=1);

namespace App\OAuth;

/** An RFC 7591 registration error (`invalid_redirect_uri`, `invalid_client_metadata`). */
final class OAuthRegistrationException extends \RuntimeException
{
    public function __construct(public readonly string $error, string $description)
    {
        parent::__construct($description);
    }
}
