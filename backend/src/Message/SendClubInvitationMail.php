<?php

declare(strict_types=1);

namespace App\Message;

/** The raw token is only in the (encrypted) queue body; the handler drops the message when the invitation no longer matches it. */
final readonly class SendClubInvitationMail
{
    public function __construct(public string $invitationId, public string $token)
    {
    }
}
