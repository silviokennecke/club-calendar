<?php

declare(strict_types=1);

namespace App\MessageHandler;

use App\Entity\ClubInvitation;
use App\Message\SendClubInvitationMail;
use App\Service\ClubInvitationMailer;
use App\Service\PasswordResetService;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
final readonly class SendClubInvitationMailHandler
{
    public function __construct(
        private EntityManagerInterface $em,
        private ClubInvitationMailer $mailer,
        private ClockInterface $clock,
    ) {
    }

    public function __invoke(SendClubInvitationMail $message): void
    {
        $invitation = $this->em->getRepository(ClubInvitation::class)->find($message->invitationId);
        if (null === $invitation) {
            return;
        }
        $this->em->refresh($invitation);
        // Revoked, answered, expired or re-sent (new token) in the meantime: the old link must not go out.
        if (ClubInvitation::PENDING !== $invitation->getStatus()
            || $invitation->isExpired($this->clock->now())
            || !hash_equals($invitation->getTokenHash(), PasswordResetService::hash($message->token))) {
            return;
        }
        $this->mailer->send($invitation, $message->token);
    }
}
