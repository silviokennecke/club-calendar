<?php

declare(strict_types=1);

namespace App\Service;

use Psr\Log\LoggerInterface;
use Symfony\Component\Console\ConsoleEvents;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Email;
use Symfony\Contracts\Service\ResetInterface;

/**
 * Sends e-mails after the response went out (kernel.terminate; PHP-FPM finishes the request first).
 *
 * Used where the response must not depend on whether a mail is sent (forgot-password, change-email): a
 * synchronous SMTP round trip would tell an observer by timing whether the address has an account.
 * {@see defer()} runs other work at the same point (forgot-password creates its token there: the database
 * writes for an existing account would otherwise be measurable as well). A failed task or send is logged
 * without the message (it carries one-time links); the response is not affected.
 */
final class DeferredMailer implements ResetInterface
{
    /** @var list<Email> */
    private array $queue = [];
    /** @var list<\Closure(): void> */
    private array $tasks = [];

    public function __construct(
        private readonly MailerInterface $mailer,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function queue(Email $email): void
    {
        $this->queue[] = $email;
    }

    /** @param \Closure(): void $task runs after the response, before the queued mails are sent */
    public function defer(\Closure $task): void
    {
        $this->tasks[] = $task;
    }

    #[AsEventListener(event: KernelEvents::TERMINATE)]
    #[AsEventListener(event: ConsoleEvents::TERMINATE)]
    public function flush(): void
    {
        $tasks = $this->tasks;
        $this->tasks = [];
        foreach ($tasks as $task) {
            try {
                $task();
            } catch (\Throwable $e) {
                $this->logger->error('Deferred task failed', ['error' => $e::class]);
            }
        }
        $queue = $this->queue;
        $this->queue = [];
        foreach ($queue as $email) {
            try {
                $this->mailer->send($email);
            } catch (\Throwable $e) {
                $this->logger->error('Deferred e-mail could not be sent', ['error' => $e::class]);
            }
        }
    }

    public function reset(): void
    {
        $this->flush();
    }
}
