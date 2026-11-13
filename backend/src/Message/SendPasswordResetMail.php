<?php

declare(strict_types=1);

namespace App\Message;

/** Forgot-password request: lookup, token and mail happen in the handler so the request does the same work for every address. */
final readonly class SendPasswordResetMail
{
    public function __construct(public string $email)
    {
    }
}
