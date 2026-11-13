<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\ClubInvitation;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * The invitation mail: club name and inviter name, a link with the one-time token to the SPA and a link to
 * the registration for people without an account. The text is identical for registered and unregistered
 * addresses; only the language differs (the account's language if there is one, else the inviter's). Queued via
 * the mailer (Messenger), rendered by the worker.
 */
readonly class ClubInvitationMailer
{
    public function __construct(
        private MailerInterface $mailer,
        private TranslatorInterface $translator,
        private EntityManagerInterface $em,
        #[Autowire(env: 'MAILER_FROM')]
        private string $mailerFrom,
        #[Autowire(env: 'FRONTEND_URL')]
        private string $frontendUrl,
    ) {
    }

    public function invitationUrl(string $token): string
    {
        return rtrim($this->frontendUrl, '/').'/invitations?'.http_build_query(['token' => $token]);
    }

    public function registerUrl(): string
    {
        return rtrim($this->frontendUrl, '/').'/signup';
    }

    public function send(ClubInvitation $invitation, string $token): void
    {
        $inviter = $invitation->getInvitedBy();
        $existing = $this->em->getRepository(User::class)->findOneBy(['email' => $invitation->getEmail()]);
        $locale = $existing?->getLanguage() ?? $inviter?->getLanguage() ?? 'en';
        $clubName = $invitation->getClub()->getName();

        $this->mailer->send(
            new TemplatedEmail()
                ->from($this->mailerFrom)
                ->to($invitation->getEmail())
                ->subject($this->translator->trans('email.invitation.subject', ['club' => $clubName], 'messages', $locale))
                ->htmlTemplate('email/club_invitation.html.twig')
                ->locale($locale)
                ->context([
                    'clubName' => $clubName,
                    'inviterName' => $inviter?->getName() ?? '',
                    'invitationUrl' => $this->invitationUrl($token),
                    'registerUrl' => $this->registerUrl(),
                    'validDays' => ClubInvitation::TTL_DAYS,
                ]),
        );
    }
}
