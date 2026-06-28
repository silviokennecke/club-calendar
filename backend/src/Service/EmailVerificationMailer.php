<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use Random\RandomException;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Routing\Generator\UrlGeneratorInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

readonly class EmailVerificationMailer
{
    public function __construct(
        private MailerInterface $mailer,
        private EmailVerificationService $verificationService,
        private UrlGeneratorInterface $urlGenerator,
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
        [$ev, $rawVerifier] = $this->verificationService->createVerification($user);

        $verificationUrl = $this->urlGenerator->generate(
            'api_auth_verify_email',
            ['id' => $ev->getId(), 'token' => $rawVerifier],
            UrlGeneratorInterface::ABSOLUTE_URL,
        );

        $email = new TemplatedEmail()
            ->from($this->mailerFrom)
            ->to($user->getEmail())
            ->subject($this->translator->trans('email.verify.subject', [], 'messages', $user->getLanguage()))
            ->htmlTemplate('email/verify_email.html.twig')
            ->locale($user->getLanguage())
            ->context([
                'userName' => $user->getName(),
                'verificationUrl' => $verificationUrl,
            ]);

        $this->mailer->send($email);
    }
}
