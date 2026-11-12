<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Security\ClientContext;
use App\Security\ClientContextResolver;
use App\Security\NonceStore;
use App\Service\AccountMailer;
use App\Service\DeferredMailer;
use App\Service\SecurityEventLogger;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\NullLogger;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class SecurityEventLoggerTest extends KernelTestCase
{
    use ClockSensitiveTrait;

    private EntityManagerInterface $em;
    private SecurityEventLogger $logger;
    private User $user;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        self::mockTime(new \DateTimeImmutable('2026-11-11 10:00:00', new \DateTimeZone('UTC')));
        $this->logger = $c->get(SecurityEventLogger::class);
        $this->user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class), 'alice@example.com');
        $this->user->setLanguage('en')->setName('Alice');
        $this->em->flush();
    }

    private function ctx(string $ip = '203.0.113.5'): ClientContext
    {
        return new ClientContext($ip, 'Chrome 126', 'Berlin', 'DE');
    }

    private function failLogin(string $ip = '203.0.113.5', string $method = 'password', ?string $provider = null, SecurityEventType $type = SecurityEventType::LOGIN): void
    {
        $this->logger->record($this->user, $type, false, $method, $provider, $this->ctx($ip));
    }

    /** @return list<array<string, mixed>> */
    private function rows(): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative('SELECT * FROM security_event ORDER BY created_at, id');
    }

    /** @return list<Email> */
    private function mails(): array
    {
        static::getContainer()->get(DeferredMailer::class)->flush();

        return array_values(array_filter(self::getMailerMessages(), fn ($m) => $m instanceof Email));
    }

    public function testSuccessStoresContext(): void
    {
        $this->logger->record($this->user, SecurityEventType::LOGIN, true, 'sso', 'google', $this->ctx());
        $rows = $this->rows();
        $this->assertCount(1, $rows);
        $this->assertSame('login', $rows[0]['type']);
        $this->assertSame('sso', $rows[0]['method']);
        $this->assertSame('google', $rows[0]['provider']);
        $this->assertSame('203.0.113.5', $rows[0]['ip']);
        $this->assertSame('Berlin', $rows[0]['city']);
        $this->assertSame('DE', $rows[0]['country']);
        $this->assertSame('Chrome 126', $rows[0]['browser']);
        $this->assertSame('2026-11-11 10:00:00', $rows[0]['created_at']);
    }

    public function testFailuresOfTheSameKindAreFolded(): void
    {
        $this->failLogin();
        $this->failLogin();
        $this->failLogin();
        $rows = $this->rows();
        $this->assertCount(1, $rows);
        $this->assertSame(3, (int) $rows[0]['attempts']);
    }

    public function testDifferentIpMethodOrProviderGetsItsOwnRow(): void
    {
        $this->failLogin('203.0.113.5');
        $this->failLogin('203.0.113.6');
        $this->failLogin('203.0.113.5', 'passkey');
        $this->failLogin('203.0.113.5', 'sso', 'google');
        $this->assertCount(4, $this->rows());
    }

    public function testFailureAfterAnHourIsANewRow(): void
    {
        $this->failLogin();
        self::mockTime(new \DateTimeImmutable('2026-11-11 11:00:01', new \DateTimeZone('UTC')));
        $this->failLogin();
        $this->assertCount(2, $this->rows());
    }

    public function testDailyCapOfFailureRows(): void
    {
        for ($i = 1; $i <= SecurityEventLogger::FAILURE_ROWS_PER_DAY + 5; ++$i) {
            $this->failLogin('198.51.100.'.$i);
        }
        $rows = $this->rows();
        $this->assertCount(SecurityEventLogger::FAILURE_ROWS_PER_DAY, $rows);
        $this->assertSame(6, array_sum(array_map(fn ($r) => (int) $r['attempts'], $rows)) - SecurityEventLogger::FAILURE_ROWS_PER_DAY + 1);
    }

    public function testSuccessesAreNotCapped(): void
    {
        for ($i = 0; $i < SecurityEventLogger::FAILURE_ROWS_PER_DAY + 3; ++$i) {
            $this->logger->record($this->user, SecurityEventType::LOGIN, true, 'password', null, $this->ctx());
        }
        $this->assertCount(SecurityEventLogger::FAILURE_ROWS_PER_DAY + 3, $this->rows());
    }

    public function testLoggerErrorsDoNotReachTheCaller(): void
    {
        $connection = $this->createStub(Connection::class);
        $connection->method('insert')->willThrowException(new \RuntimeException('db gone'));
        $clock = static::getContainer()->get('clock');
        $logger = new SecurityEventLogger(
            $connection,
            $clock,
            $this->createStub(ClientContextResolver::class),
            new NonceStore($connection, $clock),
            $this->createStub(AccountMailer::class),
            new NullLogger(),
        );
        $logger->record($this->user, SecurityEventType::LOGIN, true, 'password', null, $this->ctx());
        $this->addToAssertionCount(1);
    }

    public function testNoMailForTwoFailuresOneMailFromTheThirdNoFurtherMailWithin24Hours(): void
    {
        $this->failLogin();
        $this->failLogin();
        $this->assertCount(0, $this->mails());

        $this->failLogin('203.0.113.9');
        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $this->assertSame('alice@example.com', $mails[0]->getTo()[0]->getAddress());
        $this->assertSame('Failed sign-in attempts on your account', $mails[0]->getSubject());
        $html = (string) $mails[0]->getHtmlBody();
        $this->assertStringContainsString('3 failed sign-in attempts', $html);
        $this->assertStringContainsString('203.0.113.9', $html);
        $this->assertStringContainsString('Berlin, Germany', $html);
        $this->assertStringContainsString('Chrome 126', $html);
        $this->assertStringContainsString('/forgot-password', $html);

        for ($i = 0; $i < 4; ++$i) {
            $this->failLogin();
        }
        // later in the day, new hour window
        self::mockTime(new \DateTimeImmutable('2026-11-11 15:00:00', new \DateTimeZone('UTC')));
        $this->failLogin();
        $this->failLogin();
        $this->failLogin();
        $this->assertCount(1, $this->mails());

        // 24 h after the mail a new series may notify again
        self::mockTime(new \DateTimeImmutable('2026-11-12 10:01:00', new \DateTimeZone('UTC')));
        $this->failLogin();
        $this->failLogin();
        $this->failLogin();
        $this->assertCount(2, $this->mails());
    }

    public function testMailIsPerMethodAndSuccessesDoNotCount(): void
    {
        $this->failLogin();
        $this->failLogin();
        $this->logger->record($this->user, SecurityEventType::LOGIN, true, 'password', null, $this->ctx());
        $this->failLogin('203.0.113.5', 'passkey');
        $this->assertCount(0, $this->mails());
    }

    public function testMailUsesAccountLanguage(): void
    {
        $this->user->setLanguage('de');
        $this->em->flush();
        $this->failLogin();
        $this->failLogin();
        $this->failLogin();
        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $this->assertSame('Fehlgeschlagene Anmeldeversuche bei deinem Konto', $mails[0]->getSubject());
        $this->assertStringContainsString('Berlin, Deutschland', (string) $mails[0]->getHtmlBody());
    }

    public function testHostileUserAgentLeavesNoUrlInRowsOrMail(): void
    {
        $ua = 'URGENT: your account is locked, restore at https://evil.example/restore now/1.0 CFNetwork/1.0 Darwin/1.0';
        $context = new ClientContext('203.0.113.5', \App\Security\UserAgentSummary::browser($ua), 'Berlin', 'DE', $ua);
        for ($i = 0; $i < 3; ++$i) {
            $this->logger->record($this->user, SecurityEventType::LOGIN, false, 'password', null, $context);
        }
        $row = $this->rows()[0];
        $this->assertNull($row['browser']);
        $this->assertSame($ua, $row['user_agent']);
        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $html = (string) $mails[0]->getHtmlBody().(string) $mails[0]->getTextBody();
        $this->assertStringNotContainsString('evil.example', $html);
        $this->assertStringNotContainsString('https://evil', $html);
    }
}
