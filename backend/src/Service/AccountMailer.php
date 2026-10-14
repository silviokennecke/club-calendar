<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\Club;
use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Translation\TranslatorInterface;

/**
 * Mails for account changes: one-time links (password reset, new e-mail address) and notices about a
 * change (password changed, e-mail change requested / done). The links are built from configured base
 * URLs (FRONTEND_URL, BACKEND_URL), never from the request's Host header. Notices carry no token and no
 * link except the general "forgot password" page; a new address appears only masked. Sending happens
 * after the response ({@see DeferredMailer}); a transport error is logged there and never breaks the flow.
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
        private EntityManagerInterface $em,
        private ClockInterface $clock,
    ) {
    }

    /** The general "forgot password" page (the only link of the notices; no token). */
    public function forgotPasswordUrl(): string
    {
        return rtrim($this->frontendUrl, '/').'/forgot-password';
    }

    /** "m***@example.com": first character of the local part, the domain in full. */
    public static function maskEmail(string $email): string
    {
        $at = strrpos($email, '@');
        if (false === $at || 0 === $at) {
            return '***';
        }

        return mb_substr(substr($email, 0, $at), 0, 1).'***'.substr($email, $at);
    }

    /** Notice to the account's address after a password change or a reset (no link but "forgot password"). */
    public function sendPasswordChanged(User $user): void
    {
        $this->mailer->queue($this->email(
            $user,
            $user->getEmail(),
            'email.password_changed.subject',
            'email/password_changed.html.twig',
            $this->noticeContext($user),
        ));
    }

    /** Notice to the CURRENT address that a change to `$newEmail` (shown masked) was requested. */
    public function sendEmailChangeRequested(User $user, string $newEmail): void
    {
        $this->mailer->queue($this->email(
            $user,
            $user->getEmail(),
            'email.email_change_requested.subject',
            'email/email_change_requested.html.twig',
            $this->noticeContext($user) + ['maskedEmail' => self::maskEmail($newEmail)],
        ));
    }

    /** Notice to the FORMER address after the change to `$newEmail` (shown masked) was confirmed. */
    public function sendEmailChanged(User $user, string $oldEmail, string $newEmail): void
    {
        $this->mailer->queue($this->email(
            $user,
            $oldEmail,
            'email.email_changed.subject',
            'email/email_changed.html.twig',
            $this->noticeContext($user) + ['maskedEmail' => self::maskEmail($newEmail)],
        ));
    }

    /** @return array<string, string> when (UTC and, if known, the user's calendar zone) and the forgot-password page */
    private function noticeContext(User $user): array
    {
        $locale = $user->getLanguage();
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        $format = fn (\DateTimeImmutable $at, string $key, array $extra = []) => $this->translator->trans($key, [
            'date' => $at->format('de' === $locale ? 'd.m.Y' : 'Y-m-d'),
            'time' => $at->format('H:i'),
        ] + $extra, 'messages', $locale);
        $when = $format($now, 'email.notice.when_utc');
        $zone = $this->userZone($user);
        if (null !== $zone && 'UTC' !== $zone) {
            $when .= ' '.$format($now->setTimezone(new \DateTimeZone($zone)), 'email.notice.when_local', ['zone' => $zone]);
        }

        return ['when' => $when, 'forgotUrl' => $this->forgotPasswordUrl()];
    }

    /** Zone of the user's last calendar (calendar, else club), else of the last club; null if unknown. */
    private function userZone(User $user): ?string
    {
        $zone = null;
        $calendar = null !== $user->getLastCalendarId() ? $this->em->find(Calendar::class, $user->getLastCalendarId()) : null;
        if (null !== $calendar) {
            $zone = $calendar->getTimezone() ?? $calendar->getClub()->getTimezone();
        } elseif (null !== $user->getLastClubId()) {
            $zone = $this->em->find(Club::class, $user->getLastClubId())?->getTimezone();
        }
        if (null === $zone || !in_array($zone, \DateTimeZone::listIdentifiers(), true)) {
            return null;
        }

        return $zone;
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
