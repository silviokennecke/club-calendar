<?php

declare(strict_types=1);

namespace App\MessageHandler;

use App\Message\SendPasswordResetMail;
use App\Service\PasswordResetService;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
final readonly class SendPasswordResetMailHandler
{
    public function __construct(private PasswordResetService $passwordResets)
    {
    }

    public function __invoke(SendPasswordResetMail $message): void
    {
        $this->passwordResets->sendResetIfAccount($message->email);
    }
}
