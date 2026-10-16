<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Random\RandomException;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

/** Issues a new confirmation code (the earlier ones die) and mails it; the mail has the code and no link. */
readonly class EmailVerificationMailer
{
    public function __construct(
        private MailerInterface $mailer,
        private EmailVerificationService $verificationService,
        private TranslatorInterface $translator,
        #[Autowire(env: 'MAILER_FROM')]
        private string $mailerFrom,
    ) {
    }

    /**
     * @throws RandomException
     * @throws TransportExceptionInterface
     */
    public function send(User $user): void
    {
        $code = $this->verificationService->issueCode($user);

        $email = new TemplatedEmail()
            ->from($this->mailerFrom)
            ->to($user->getEmail())
            ->subject($this->translator->trans('email.verify.subject', [], 'messages', $user->getLanguage()))
            ->htmlTemplate('email/verify_email.html.twig')
            ->locale($user->getLanguage())
            ->context([
                'userName' => $user->getName(),
                'code' => $code,
                'validMinutes' => intdiv(EmailVerificationService::CODE_TTL, 60),
            ]);

        $this->mailer->send($email);
    }
}
