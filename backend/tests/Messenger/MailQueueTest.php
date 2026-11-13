<?php

declare(strict_types=1);

namespace App\Tests\Messenger;

use App\Entity\ClubInvitation;
use App\Message\SendClubInvitationMail;
use App\Message\SendPasswordResetMail;
use App\Messenger\EncryptingSerializer;
use App\Security\AuthRateLimiter;
use App\Security\Secret\SecretCipher;
use App\Service\ClubInvitationService;
use App\Service\PasswordResetService;
use App\Service\Quota;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\Mailer\Envelope;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\Messenger\MessageHandler;
use Symfony\Component\Mailer\Messenger\SendEmailMessage;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Symfony\Component\Messenger\Envelope as MessengerEnvelope;
use Symfony\Component\Messenger\EventListener\SendFailedMessageForRetryListener;
use Symfony\Component\Messenger\EventListener\StopWorkerOnMessageLimitListener;
use Symfony\Component\Messenger\Handler\HandlersLocator;
use Symfony\Component\Messenger\MessageBus;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Middleware\HandleMessageMiddleware;
use Symfony\Component\Messenger\Retry\MultiplierRetryStrategy;
use Symfony\Component\Messenger\Stamp\RedeliveryStamp;
use Symfony\Component\Messenger\Stamp\TransportNamesStamp;
use Symfony\Component\Messenger\Transport\InMemory\InMemoryTransport;
use Symfony\Component\Messenger\Transport\Serialization\PhpSerializer;
use Symfony\Component\Messenger\Worker;
use Symfony\Component\Mime\RawMessage;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Mail goes through the queue: the request only enqueues, the worker side renders and sends. Tests route to the
 * in-memory `async` transport with a TransportNamesStamp (the test config sends mail messages inline).
 */
class MailQueueTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private InMemoryTransport $async;
    private MessageBusInterface $bus;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = self::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->async = $c->get('messenger.transport.async');
        $this->async->reset();
        $this->bus = $c->get(MessageBusInterface::class);
    }

    /** A bus that forces every message onto the in-memory async transport. */
    private function queueingBus(): MessageBusInterface
    {
        $inner = $this->bus;

        return new class($inner) implements MessageBusInterface {
            public function __construct(private readonly MessageBusInterface $inner)
            {
            }

            public function dispatch(object $message, array $stamps = []): MessengerEnvelope
            {
                return $this->inner->dispatch($message, [...$stamps, new TransportNamesStamp('async')]);
            }
        };
    }

    private function runWorker(int $limit): void
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addSubscriber(new StopWorkerOnMessageLimitListener($limit));
        new Worker(['async' => $this->async], $this->bus, $dispatcher)->run();
    }

    /** @return list<\Symfony\Component\Mime\Email> */
    private function mails(): array
    {
        return array_values(array_filter(self::getMailerMessages(), fn ($m) => $m instanceof \Symfony\Component\Mime\Email));
    }

    private function passwordResets(): PasswordResetService
    {
        $c = self::getContainer();

        return new PasswordResetService(
            $this->em,
            $c->get(UserPasswordHasherInterface::class),
            $c->get(\App\Service\AccountMailer::class),
            $c->get(ClockInterface::class),
            $this->queueingBus(),
            $c->get(\App\Security\ClientContextResolver::class),
            $c->get(\App\Service\SecurityEventLogger::class),
        );
    }

    public function testEncodedEnvelopeDoesNotContainPlaintextSecrets(): void
    {
        $token = bin2hex(random_bytes(32));
        $email = new TemplatedEmail()
            ->from('noreply@test.example.com')
            ->to('secret.person@example.com')
            ->subject('Reset')
            ->htmlTemplate('email/reset_password.html.twig')
            ->context(['resetUrl' => 'https://app.example/reset-password?token='.$token, 'code' => '482913']);
        $serializer = new EncryptingSerializer(new PhpSerializer(), self::getContainer()->get(SecretCipher::class));

        $encoded = $serializer->encode(new MessengerEnvelope(new SendEmailMessage($email, new Envelope(new \Symfony\Component\Mime\Address('noreply@test.example.com'), [new \Symfony\Component\Mime\Address('secret.person@example.com')]))));

        $this->assertStringStartsWith('enc:', $encoded['body']);
        foreach ([$token, '482913', 'secret.person@example.com', 'reset-password'] as $plain) {
            $this->assertStringNotContainsString($plain, $encoded['body']);
            $this->assertStringNotContainsString($plain, json_encode($encoded['headers'] ?? []));
        }
        $decoded = $serializer->decode($encoded)->getMessage();
        $this->assertInstanceOf(SendEmailMessage::class, $decoded);
        $restored = $decoded->getMessage();
        $this->assertInstanceOf(TemplatedEmail::class, $restored);
        $this->assertStringContainsString($token, $restored->getContext()['resetUrl']);
    }

    public function testQueuedInvitationMessageBodyIsEncrypted(): void
    {
        $serializer = new EncryptingSerializer(new PhpSerializer(), self::getContainer()->get(SecretCipher::class));
        $encoded = $serializer->encode(new MessengerEnvelope(new SendClubInvitationMail('id-1', 'tok-abcdef0123456789')));

        $this->assertStringNotContainsString('tok-abcdef0123456789', $encoded['body']);
    }

    public function testForgotPasswordEnqueuesIdenticallyAndTheWorkerDoesTheRest(): void
    {
        $hasher = self::getContainer()->get(UserPasswordHasherInterface::class);
        $user = TestHelper::createUser($this->em, $hasher, 'known@example.com');
        $service = $this->passwordResets();

        $service->requestReset('known@example.com');
        $service->requestReset('unknown@example.com');

        $sent = $this->async->getSent();
        $this->assertCount(2, $sent);
        foreach ($sent as $envelope) {
            $this->assertInstanceOf(SendPasswordResetMail::class, $envelope->getMessage());
        }
        // Nothing account-dependent happened in the request: no token, no mail.
        $this->assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM password_reset'));
        $this->assertCount(0, $this->mails());

        $this->runWorker(2);

        $this->assertSame(1, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM password_reset'));
        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $this->assertSame($user->getEmail(), $mails[0]->getTo()[0]->getAddress());
    }

    public function testInvitationIsEnqueuedByTheRequestAndSentByTheWorkerOnce(): void
    {
        $c = self::getContainer();
        $hasher = $c->get(UserPasswordHasherInterface::class);
        $owner = TestHelper::createUser($this->em, $hasher, 'owner@example.com');
        $club = TestHelper::createClub($this->em, $owner, 'Schützenverein');
        $service = new ClubInvitationService(
            $this->em,
            $c->get(Quota::class),
            $c->get(ClockInterface::class),
            $this->queueingBus(),
            $c->get(AuthRateLimiter::class),
        );

        $service->invite($club, $owner, 'new@example.com');

        $this->assertCount(1, $this->async->getSent());
        $this->assertInstanceOf(SendClubInvitationMail::class, $this->async->getSent()[0]->getMessage());
        $this->assertCount(0, $this->mails());

        $this->runWorker(1);

        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $this->assertStringContainsString('/invitations?token=', (string) $mails[0]->getHtmlBody());
    }

    public function testStaleInvitationMessageIsDroppedWhenResentOrRevoked(): void
    {
        $c = self::getContainer();
        $hasher = $c->get(UserPasswordHasherInterface::class);
        $owner = TestHelper::createUser($this->em, $hasher, 'owner@example.com');
        $club = TestHelper::createClub($this->em, $owner, 'Schützenverein');
        $service = new ClubInvitationService($this->em, $c->get(Quota::class), $c->get(ClockInterface::class), $this->queueingBus(), $c->get(AuthRateLimiter::class));
        $service->invite($club, $owner, 'new@example.com');
        $invitation = $this->em->getRepository(ClubInvitation::class)->findOneBy(['email' => 'new@example.com']);
        $service->resend($club, $owner, $invitation->getId());

        $this->runWorker(2);

        // Only the message with the current token goes out.
        $this->assertCount(1, $this->mails());
    }

    public function testFailingTransportLeadsToRetryNotToALostMail(): void
    {
        $failing = new class implements TransportInterface {
            public function send(RawMessage $message, ?Envelope $envelope = null): ?SentMessage
            {
                throw new TransportException('smtp down');
            }

            public function __toString(): string
            {
                return 'failing://';
            }
        };
        $bus = new MessageBus([new HandleMessageMiddleware(new HandlersLocator([
            SendEmailMessage::class => [new MessageHandler($failing)],
        ]))]);
        $failedTransport = new InMemoryTransport();
        $dispatcher = new EventDispatcher();
        $dispatcher->addSubscriber(new SendFailedMessageForRetryListener(
            new ServiceLocator(['async' => fn () => $this->async]),
            new ServiceLocator(['async' => fn () => new MultiplierRetryStrategy(3, 0)]),
        ));
        $dispatcher->addSubscriber(new StopWorkerOnMessageLimitListener(1));

        $email = new \Symfony\Component\Mime\Email()->from('a@example.com')->to('b@example.com')->subject('x')->text('y');
        $this->async->send(new MessengerEnvelope(new SendEmailMessage($email)));
        new Worker(['async' => $this->async], $bus, $dispatcher)->run();

        $sent = $this->async->getSent();
        $this->assertCount(2, $sent, 'the failed message is re-queued');
        $this->assertSame(1, $sent[1]->last(RedeliveryStamp::class)?->getRetryCount());
        $this->assertCount(0, $failedTransport->getSent());
    }

    public function testRetryStrategyOfTheAsyncTransportIsConfigured(): void
    {
        $config = \Symfony\Component\Yaml\Yaml::parseFile(__DIR__.'/../../config/packages/messenger.yaml');
        $this->assertSame('async', $config['framework']['messenger']['routing'][SendEmailMessage::class]);
        $this->assertSame(3, $config['framework']['messenger']['transports']['async']['retry_strategy']['max_retries']);
    }
}
