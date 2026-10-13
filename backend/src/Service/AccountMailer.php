<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Mails with one-time links for account changes (password reset, new e-mail address). The links are
 * built from configured base URLs (FRONTEND_URL, BACKEND_URL), never from the request's Host header.
 * Sending happens after the response ({@see DeferredMailer}).
 */
readonly class AccountMailer
{
    public function __construct(
        private DeferredMailer $mailer,
        private TranslatorInterface $translator,
        #[Autowire(env: 'MAILER_FROM')]
        private string $mailerFrom,
        #[Autowire(env: 'FRONTEND_URL')]
        private string $frontendUrl,
        #[Autowire(env: 'BACKEND_URL')]
        private string $backendUrl,
    ) {
    }

    public function passwordResetUrl(string $token): string
    {
        return rtrim($this->frontendUrl, '/').'/reset-password?'.http_build_query(['token' => $token]);
    }

    public function newEmailConfirmationUrl(string $token): string
    {
        return rtrim($this->backendUrl, '/').'/api/auth/verify-new-email?'.http_build_query(['token' => $token]);
    }

    public function sendPasswordReset(User $user, string $token): void
    {
        $this->mailer->queue($this->email(
            $user,
            $user->getEmail(),
            'email.reset.subject',
            'email/reset_password.html.twig',
            ['resetUrl' => $this->passwordResetUrl($token)],
        ));
    }

    public function sendNewEmailConfirmation(User $user, string $newEmail, string $token): void
    {
        $this->mailer->queue($this->email(
            $user,
            $newEmail,
            'email.change.subject',
            'email/confirm_new_email.html.twig',
            ['confirmUrl' => $this->newEmailConfirmationUrl($token), 'newEmail' => $newEmail],
        ));
    }

    /** @param array<string, string> $context */
    private function email(User $user, string $to, string $subjectKey, string $template, array $context): TemplatedEmail
    {
        return new TemplatedEmail()
            ->from($this->mailerFrom)
            ->to($to)
            ->subject($this->translator->trans($subjectKey, [], 'messages', $user->getLanguage()))
            ->htmlTemplate($template)
            ->locale($user->getLanguage())
            ->context(['userName' => $user->getName()] + $context);
    }
}
