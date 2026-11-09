<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Service\AccountMailer;
use App\Service\PasswordResetService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mailer\Envelope;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\RawMessage;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Notices about account changes (information only): "password changed" after change-password and
 * reset-password, "change requested" to the current address after change-email, "address changed" to the
 * FORMER address after the confirmation link. Never a token or a link except the general forgot-password
 * page; the new address only masked; sent after the response; no mail on failures; a transport error
 * changes nothing.
 */
class NoticeMailTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;
    private static string $frontendUrl;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
        self::$frontendUrl = rtrim((string) $_ENV['FRONTEND_URL'], '/');
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        self::mockTime(new \DateTimeImmutable('2026-10-14 10:30:00', new \DateTimeZone('UTC')));
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    private function auth(User $user): string
    {
        return 'Bearer '.self::$tokens->createAccessToken($user);
    }

    private function user(string $email = 'alice@example.com', string $language = 'en', string $name = 'Alice'): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email);
        $user->setLanguage($language)->setName($name);
        self::$em->flush();

        return $user;
    }

    /** @return list<Email> */
    private function mails(): array
    {
        return array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
    }

    private function mailTo(string $address): Email
    {
        $found = array_values(array_filter($this->mails(), fn (Email $m) => $m->getTo()[0]->getAddress() === $address));
        $this->assertCount(1, $found, "one mail to $address");

        return $found[0];
    }

    /** No token, no link but the forgot-password page. */
    private function assertOnlyForgotPasswordLink(Email $mail): void
    {
        $html = (string) $mail->getHtmlBody();
        preg_match_all('#href="([^"]*)"#', $html, $m);
        $this->assertSame([self::$frontendUrl.'/forgot-password'], array_values(array_unique($m[1])), $html);
        $this->assertDoesNotMatchRegularExpression('#[0-9a-f]{40,}#', $html, 'no token');
        $this->assertStringNotContainsString('token', strtolower($html));
        $this->assertStringNotContainsString('reset-password', $html);
        $this->assertStringNotContainsString('verify-new-email', $html);
    }

    private function changePassword(User $user, string $current = 'password123', string $new = 'new-password-1'): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', [
            'currentPassword' => $current, 'newPassword' => $new,
        ], $this->auth($user));
    }

    private function changeEmail(User $user, string $email, ?string $password = 'password123'): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-email', ['email' => $email, 'password' => $password], $this->auth($user));
    }

    private function confirmationToken(): string
    {
        foreach ($this->mails() as $mail) {
            if (preg_match('#verify-new-email\?token=([0-9a-f]{64})#', (string) $mail->getHtmlBody(), $m)) {
                return $m[1];
            }
        }
        $this->fail('no confirmation mail');
    }

    // ---- Password changed -------------------------------------------------------------------------

    public function testChangingThePasswordSendsANoticeToTheAccountAddress(): void
    {
        ['user' => $user, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $user->setLastClubId($club->getId())->setLanguage('de')->setName('Alice');
        self::$em->flush();

        $r = $this->changePassword($user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertEmailCount(1);
        $mail = $this->mailTo($user->getEmail());
        $this->assertSame('Dein Passwort wurde geändert', $mail->getSubject());
        $html = (string) $mail->getHtmlBody();
        // When: UTC and the zone of the user's club
        $this->assertStringContainsString('14.10.2026 um 10:30 Uhr UTC', $html);
        $this->assertStringContainsString('(12:30 Uhr in der Zeitzone Europe/Berlin)', $html);
        $this->assertStringContainsString('Passwort vergessen', $html);
        $this->assertStringContainsString('Support', $html);
        $this->assertOnlyForgotPasswordLink($mail);
    }

    public function testNoticeIsInTheUsersLanguageWithAnEscapedNameAndWithoutZoneIfUnknown(): void
    {
        $user = $this->user('eve@example.com', 'en', '<b>Eve</b> & "Co"');
        $this->assertSame(200, $this->changePassword($user)['status']);
        $mail = $this->mailTo('eve@example.com');
        $this->assertSame('Your password was changed', $mail->getSubject());
        $html = (string) $mail->getHtmlBody();
        $this->assertStringContainsString('2026-10-14 at 10:30 UTC', $html);
        $this->assertStringNotContainsString('time zone', $html);
        $this->assertStringNotContainsString('<b>Eve</b>', $html);
        $this->assertStringContainsString('&lt;b&gt;Eve&lt;/b&gt;', $html);
    }

    public function testNoNoticeWhenThePasswordChangeFails(): void
    {
        $user = $this->user();
        $this->assertSame(400, $this->changePassword($user, 'wrong-password')['status']);
        $this->assertEmailCount(0);
        $this->assertSame(422, $this->changePassword($user, 'password123', 'short')['status']);
        $this->assertEmailCount(0);
    }

    public function testResettingThePasswordSendsTheNoticeButForgotPasswordDoesNot(): void
    {
        $user = $this->user('alice@example.com', 'de');
        // Requesting a link sends at most the link (a notice per request would be a spam vector; the
        // IP limiter of forgot-password may already be used up by other test classes)
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/forgot-password', ['email' => 'alice@example.com']);
        $this->assertSame(204, $r['status']);
        foreach ($this->mails() as $mail) {
            $this->assertSame('Neues Passwort für Club Calendar festlegen', $mail->getSubject());
        }

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/reset-password', ['token' => str_repeat('0', 64), 'password' => 'new-password-1']);
        $this->assertSame(400, $r['status']);
        $this->assertEmailCount(0);

        $container = static::getContainer();
        $token = $container->get(PasswordResetService::class)->createToken($container->get(EntityManagerInterface::class)->find(User::class, $user->getId()));
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/reset-password', ['token' => $token, 'password' => 'new-password-1']);
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertEmailCount(1);
        $mail = $this->mailTo('alice@example.com');
        $this->assertSame('Dein Passwort wurde geändert', $mail->getSubject());
        $this->assertStringNotContainsString($token, (string) $mail->getHtmlBody());
        $this->assertOnlyForgotPasswordLink($mail);
    }

    // ---- E-mail change ----------------------------------------------------------------------------

    public function testRequestingAnEmailChangeNotifiesTheCurrentAddressWithTheNewOneMasked(): void
    {
        $user = $this->user('alice@example.com', 'de');
        $this->assertSame(204, $this->changeEmail($user, 'mallory.new@beispiel.de')['status']);
        $this->assertEmailCount(2);

        // The link goes to the new address, the notice to the current one
        $this->assertStringContainsString('verify-new-email?token=', (string) $this->mailTo('mallory.new@beispiel.de')->getHtmlBody());
        $notice = $this->mailTo('alice@example.com');
        $this->assertSame('Es wurde eine Änderung deiner E-Mail-Adresse angefordert', $notice->getSubject());
        $html = (string) $notice->getHtmlBody();
        $this->assertStringContainsString('m***@beispiel.de', $html);
        $this->assertStringNotContainsString('mallory.new', $html);
        $this->assertStringContainsString('14.10.2026 um 10:30 Uhr UTC', $html);
        $this->assertOnlyForgotPasswordLink($notice);
    }

    public function testATakenNewAddressGetsNoMailButTheCurrentAddressIsNotified(): void
    {
        $user = $this->user();
        $this->user('bob@example.com');
        $this->assertSame(204, $this->changeEmail($user, 'bob@example.com')['status']);
        $this->assertEmailCount(1);
        $this->assertSame('A change of your e-mail address was requested', $this->mailTo('alice@example.com')->getSubject());
        $this->assertStringContainsString('b***@example.com', (string) $this->mailTo('alice@example.com')->getHtmlBody());
    }

    public function testNoNoticeWhenTheEmailChangeIsRejected(): void
    {
        $user = $this->user();
        $this->assertSame(400, $this->changeEmail($user, 'new@example.com', 'wrong')['status']);
        $this->assertEmailCount(0);
        $this->assertSame(422, $this->changeEmail($user, 'not-an-address')['status']);
        $this->assertEmailCount(0);
        $this->assertSame(422, $this->changeEmail($user, 'ALICE@example.com')['status']);
        $this->assertEmailCount(0);
    }

    public function testConfirmingNotifiesTheFormerAddress(): void
    {
        $user = $this->user('alice@example.com', 'en');
        $this->changeEmail($user, 'alice.new@example.com');
        $token = $this->confirmationToken();

        // A broken link changes nothing and sends nothing
        self::$client->request('GET', '/api/auth/verify-new-email?token='.str_repeat('a', 64));
        $this->assertEmailCount(0);

        self::$client->request('GET', '/api/auth/verify-new-email?token='.$token);
        $this->assertSame(302, self::$client->getResponse()->getStatusCode());
        $this->assertStringContainsString('status=email_changed', (string) self::$client->getResponse()->headers->get('Location'));
        $this->assertEmailCount(1);
        $mail = $this->mailTo('alice@example.com');
        $this->assertSame('Your e-mail address was changed', $mail->getSubject());
        $html = (string) $mail->getHtmlBody();
        $this->assertStringContainsString('a***@example.com', $html);
        $this->assertStringNotContainsString('alice.new', $html);
        $this->assertStringNotContainsString($token, $html);
        $this->assertOnlyForgotPasswordLink($mail);

        // Used again: no further mail
        self::$client->request('GET', '/api/auth/verify-new-email?token='.$token);
        $this->assertEmailCount(0);
    }

    // ---- Delivery ---------------------------------------------------------------------------------

    public function testNoticesAreSentAfterTheResponse(): void
    {
        $user = $this->user();
        $sentBeforeTerminate = null;
        $dispatcher = static::getContainer()->get('event_dispatcher');
        $listener = function () use (&$sentBeforeTerminate): void {
            $sentBeforeTerminate ??= count($this->getMailerMessages());
        };
        $dispatcher->addListener('kernel.response', $listener, -1000);
        try {
            self::$client->disableReboot();
            $r = $this->changePassword($user);
        } finally {
            $dispatcher->removeListener('kernel.response', $listener);
            self::$client->enableReboot();
        }
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(0, $sentBeforeTerminate);
        $this->assertEmailCount(1);
    }

    public function testATransportErrorBreaksNothing(): void
    {
        $user = $this->user();
        $failing = new class implements TransportInterface {
            public int $attempts = 0;

            public function send(RawMessage $message, ?Envelope $envelope = null): ?SentMessage
            {
                ++$this->attempts;
                throw new TransportException('Connection refused');
            }

            public function __toString(): string
            {
                return 'failing://';
            }
        };
        // A fresh kernel whose mailer transport fails (the test environment uses null://null otherwise)
        self::ensureKernelShutdown();
        self::$client = static::createClient();
        self::$client->disableReboot();
        static::getContainer()->set('mailer.transports', $failing);
        try {
            $r = $this->changePassword($user);
            $this->assertSame(200, $r['status'], $r['content']);
            $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-email', ['email' => 'alice.new@example.com', 'password' => 'new-password-1'], 'Bearer '.$r['body']['access_token']);
            $this->assertSame(204, $r['status'], $r['content']);
            // password notice + confirmation link + change notice: all attempted, all failed quietly
            $this->assertSame(3, $failing->attempts);
        } finally {
            self::$client->enableReboot();
            self::ensureKernelShutdown();
            self::$client = static::createClient();
        }
        // The changes are stored although no mail could be sent
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => 'alice@example.com', 'password' => 'new-password-1'])['status']);
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        $this->assertSame(1, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM email_change'));
    }

    public function testMasking(): void
    {
        $this->assertSame('m***@beispiel.de', AccountMailer::maskEmail('max.mustermann@beispiel.de'));
        $this->assertSame('a***@example.com', AccountMailer::maskEmail('a@example.com'));
        $this->assertSame('ä***@example.com', AccountMailer::maskEmail('älter@example.com'));
        $this->assertSame('***', AccountMailer::maskEmail('@example.com'));
    }
}
