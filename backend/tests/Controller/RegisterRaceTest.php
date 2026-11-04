<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Event\PreFlushEventArgs;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** AUTH-06: two concurrent registrations pass the e-mail check; the unique index decides. */
class RegisterRaceTest extends WebTestCase
{
    private static KernelBrowser $client;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
    }

    protected function setUp(): void
    {
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (shared client), see AuthTest.
    }

    public function testLosingRegistrationAnswersEmailTakenWithoutSideEffects(): void
    {
        $em = static::getContainer()->get(EntityManagerInterface::class);
        $this->armRacingInsert($em, 'race@example.com');

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Loser', 'email' => 'race@example.com', 'password' => 'password123',
        ]);

        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('email_taken', $r['body']['code']);
        $this->assertSame('email', $r['body']['field']);
        $this->assertArrayNotHasKey('access_token', $r['body']);

        $conn = static::getContainer()->get(EntityManagerInterface::class)->getConnection();
        $this->assertSame(1, (int) $conn->fetchOne('SELECT COUNT(*) FROM user'));
        $this->assertSame('Winner', $conn->fetchOne('SELECT name FROM user'));
        $this->assertSame(0, (int) $conn->fetchOne('SELECT COUNT(*) FROM email_verification'));
        $this->assertSame(0, (int) $conn->fetchOne('SELECT COUNT(*) FROM user_consent'));
        $this->assertEmailCount(0);
    }

    public function testLosingSsoSignInIsNotAServerError(): void
    {
        $em = static::getContainer()->get(EntityManagerInterface::class);
        $this->armRacingInsert($em, 'sso-race@example.com');

        $service = static::getContainer()->get(\App\Service\AuthService::class);
        try {
            $service->findOrCreateOAuthUser('google', 'g-race', 'sso-race@example.com', 'Loser', false);
            $this->fail('expected a conflict');
        } catch (\App\Exception\OAuthAccountConflictException|\App\Exception\OAuthRegistrationRestrictedException $e) {
            $this->assertInstanceOf(\App\Exception\OAuthAccountConflictException::class, $e);
        }

        $conn = static::getContainer()->get(EntityManagerInterface::class)->getConnection();
        $this->assertSame(1, (int) $conn->fetchOne('SELECT COUNT(*) FROM user'));
    }

    private function armRacingInsert(EntityManagerInterface $em, string $email): void
    {
        $listener = new class($email) {
            private bool $done = false;

            public function __construct(private string $email)
            {
            }

            public function preFlush(PreFlushEventArgs $args): void
            {
                $em = $args->getObjectManager();
                $pending = false;
                foreach ($em->getUnitOfWork()->getIdentityMap()[User::class] ?? [] as $u) {
                    $pending = $pending || $u->getEmail() === $this->email;
                }
                if ($this->done || !$pending) {
                    return;
                }
                $this->done = true;
                $em->getConnection()->insert('user', [
                    'id' => '00000000-0000-7000-8000-000000000001',
                    'name' => 'Winner',
                    'email' => $this->email,
                    'date_format' => 'dd.MM.yyyy',
                    'first_day_of_week' => 1,
                    'language' => 'de',
                    'is_email_verified' => 0,
                    'created_at' => '2026-01-01 00:00:00',
                    'token_version' => 0,
                ]);
            }
        };
        $em->getEventManager()->addEventListener(['preFlush'], $listener);
    }
}
