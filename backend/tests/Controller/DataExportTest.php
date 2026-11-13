<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Enum\LegalDocumentType;
use App\Export\UserDataExportService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** POST /api/auth/me/export: step-up, gates, exact budgets with refund, security event and notice mail. */
class DataExportTest extends WebTestCase
{
    private const string URL = '/api/auth/me/export';

    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    private function user(string $email = 'alice@example.com', bool $verified = true): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), $email, 'password123', $verified);
        $user->setLanguage('en')->setName('Alice');
        $this->em->flush();

        return $user;
    }

    /** @return array{0: string, 1: string} */
    private function session(User $user): array
    {
        return TestHelper::stepUpSession($this->client, $user, static::getContainer()->get(TokenService::class));
    }

    private function export(string $auth, ?string $stepUp, string $ip = '203.0.113.7'): array
    {
        $headers = ['HTTP_AUTHORIZATION' => $auth, 'REMOTE_ADDR' => $ip];
        if (null !== $stepUp) {
            $headers['HTTP_X_STEP_UP_TOKEN'] = $stepUp;
        }
        $this->client->request('POST', self::URL, [], [], $headers);
        $content = (string) $this->client->getInternalResponse()->getContent();

        return ['status' => $this->client->getResponse()->getStatusCode(), 'content' => $content, 'body' => json_decode($content, true), 'headers' => $this->client->getResponse()->headers];
    }

    /** @return list<Email> */
    private function mails(): array
    {
        return array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
    }

    private function events(): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative("SELECT * FROM security_event WHERE type = 'data_export'");
    }

    public function testWithoutTokenIs401(): void
    {
        $this->client->request('POST', self::URL);
        $this->assertSame(401, $this->client->getResponse()->getStatusCode());
    }

    public function testWithoutStepUpIs403(): void
    {
        $user = $this->user();
        $auth = TestHelper::sessionHeader($user, static::getContainer()->get(TokenService::class));
        $r = $this->export($auth, null);
        $this->assertSame(403, $r['status']);
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertSame([], $this->events());
    }

    public function testSuccessStreamsTheCallersDataWithHeaders(): void
    {
        $user = $this->user();
        $other = $this->user('bob@example.com');
        [$auth, $stepUp] = $this->session($user);
        $r = $this->export($auth, $stepUp);

        $this->assertSame(200, $r['status'], $r['content']);
        $h = $r['headers'];
        $this->assertSame('application/json; charset=utf-8', $h->get('Content-Type'));
        $this->assertSame(sprintf('attachment; filename="club-calendar-export-%s-%s.json"', $user->getId(), gmdate('Ymd')), $h->get('Content-Disposition'));
        $this->assertStringContainsString('no-store', (string) $h->get('Cache-Control'));
        $this->assertSame('nosniff', $h->get('X-Content-Type-Options'));
        $this->assertSame('noindex', $h->get('X-Robots-Tag'));
        $this->assertFalse($h->has('Content-Length'));
        $this->assertSame(1, $r['body']['meta']['version']);
        $this->assertSame($user->getId(), $r['body']['meta']['userId']);
        $this->assertSame('alice@example.com', $r['body']['account']['email']);
        $this->assertStringNotContainsString($other->getEmail(), $r['content']);
    }

    public function testSuccessRecordsEventAndSendsNoticeMail(): void
    {
        $user = $this->user();
        [$auth, $stepUp] = $this->session($user);
        $this->export($auth, $stepUp, '203.0.113.9');

        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertSame('1', (string) $events[0]['success']);
        $this->assertSame('203.0.113.9', $events[0]['ip']);
        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $this->assertSame('Your data was downloaded', $mails[0]->getSubject());
        $this->assertStringContainsString('/forgot-password', (string) $mails[0]->getHtmlBody());
    }

    public function testUnverifiedUserIsGated(): void
    {
        $user = $this->user('carol@example.com', false);
        [$auth, $stepUp] = $this->session($user);
        $r = $this->export($auth, $stepUp);
        $this->assertSame(403, $r['status']);
        $this->assertSame('email_verification_required', $r['body']['code']);
    }

    public function testConsentGatedUserIsRefused(): void
    {
        $user = $this->user();
        LegalTestHelper::publish($this->em, LegalDocumentType::PRIVACY);
        LegalTestHelper::publish($this->em, LegalDocumentType::TERMS);
        [$auth, $stepUp] = $this->session($user);
        $r = $this->export($auth, $stepUp);
        $this->assertSame(403, $r['status']);
        $this->assertSame('consent_required', $r['body']['code']);
    }

    public function testSecondExportWithinTheHourIsLimited(): void
    {
        $user = $this->user();
        [$auth, $stepUp] = $this->session($user);
        $this->assertSame(200, $this->export($auth, $stepUp)['status']);

        $r = $this->export($auth, $stepUp);
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertGreaterThan(0, (int) $this->client->getResponse()->headers->get('Retry-After'));
        $this->assertLessThanOrEqual(3600, (int) $this->client->getResponse()->headers->get('Retry-After'));
        $this->assertCount(1, $this->events());
    }

    public function testDailyBudgetIsThreePerUserAfterTheHourSlotsFreeUp(): void
    {
        $user = $this->user();
        [$auth, $stepUp] = $this->session($user);
        $conn = static::getContainer()->get(Connection::class);
        for ($i = 0; $i < 3; ++$i) {
            $this->assertSame(200, $this->export($auth, $stepUp)['status'], "export $i");
            // the hour has passed
            $conn->executeStatement("UPDATE auth_nonce SET expires_at = '2000-01-01 00:00:00' WHERE nonce_hash = ?", [hash('sha256', "data_export.user_hour\0".$user->getId().'#1')]);
        }
        $r = $this->export($auth, $stepUp);
        $this->assertSame(429, $r['status']);
        // the refused attempt keeps nothing taken: 3 user-day + 3 ip-day slots, the hour slot it briefly held is gone
        $this->assertSame(6, $this->budgetSlots($user));
    }

    public function testBudgetIsRefundedWhenTheExportFails(): void
    {
        $user = $this->user();
        [$auth, $stepUp] = $this->session($user);
        $calls = 0;
        $failing = $this->createStub(UserDataExportService::class);
        $failing->method('chunks')->willReturnCallback(static function () use (&$calls): \Generator {
            yield '{"meta":';
            if (1 === ++$calls) {
                throw new \RuntimeException('db gone');
            }
            yield '{}}';
        });
        static::getContainer()->set(UserDataExportService::class, $failing);

        try {
            $this->export($auth, $stepUp);
            $this->fail('the failure must surface');
        } catch (\RuntimeException $e) {
            $this->assertSame('db gone', $e->getMessage());
        }
        $this->assertSame(0, $this->budgetSlots($user));
        $this->assertSame([], $this->events());
        $this->assertSame([], $this->mails());

        $this->assertSame(200, $this->export($auth, $stepUp)['status']);
    }

    private function budgetSlots(User $user): int
    {
        $conn = static::getContainer()->get(Connection::class);
        $count = 0;
        foreach ([['data_export.user_hour', $user->getId()], ['data_export.user_day', $user->getId()], ['data_export.ip_day', '203.0.113.7']] as [$purpose, $subject]) {
            for ($i = 1; $i <= 3; ++$i) {
                $count += (int) $conn->fetchOne('SELECT COUNT(*) FROM auth_nonce WHERE nonce_hash = ?', [hash('sha256', $purpose."\0".$subject.'#'.$i)]);
            }
        }

        return $count;
    }
}
