<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\ClubInvitation;
use App\Service\ClubInvitationService;
use App\Service\RegistrationPolicy;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** POST /api/auth/identify (e-mail-first sign-in). Every test boots its own kernel with the policy replaced. */
class IdentifyTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;

    private function boot(bool $restricted): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = static::getContainer();
        $container->set(RegistrationPolicy::class, new RegistrationPolicy($container->get(ClubInvitationService::class), $restricted));
        $this->em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    private function invite(string $email, string $expiresIn = '+3 days'): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $owner = TestHelper::createUser($this->em, $hasher, 'owner'.uniqid().'@example.com');
        $club = TestHelper::createClub($this->em, $owner);
        $invitation = new ClubInvitation($club, $owner, $email, hash('sha256', $email.$expiresIn), new \DateTimeImmutable());
        $this->em->persist($invitation);
        $this->em->flush();
        $this->em->getConnection()->executeStatement(
            'UPDATE club_invitation SET expires_at = ? WHERE id = ?',
            [(new \DateTimeImmutable($expiresIn, new \DateTimeZone('UTC')))->format('Y-m-d H:i:s'), $invitation->getId()],
        );
        $this->em->clear();
    }

    /** @return array{status: int, body: mixed} */
    private function identify(string $email): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', '/api/auth/identify', ['email' => $email]);
    }

    public function testExistingUserIsLoginAndEmailIsNormalized(): void
    {
        $this->boot(false);
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'known@example.com');
        $r = $this->identify('Known@Example.com');
        $this->assertSame(200, $r['status']);
        $this->assertSame(['email' => 'known@example.com', 'status' => 'login'], $r['body']);
    }

    public function testUnverifiedUserIsLogin(): void
    {
        $this->boot(true);
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        TestHelper::createUser($this->em, $hasher, 'unverified@example.com', 'password123', false);
        $this->assertSame('login', $this->identify('unverified@example.com')['body']['status']);
    }

    public function testUnknownAddressIsRegister(): void
    {
        $this->boot(false);
        $this->assertSame('register', $this->identify('new@example.com')['body']['status']);
    }

    public function testRestrictedWithoutInvitationIsRestricted(): void
    {
        $this->boot(true);
        $this->assertSame('registration_restricted', $this->identify('new@example.com')['body']['status']);
    }

    public function testRestrictedWithOpenInvitationIsRegister(): void
    {
        $this->boot(true);
        $this->invite('invited@example.com');
        $this->assertSame('register', $this->identify('Invited@example.com')['body']['status']);
    }

    public function testRestrictedWithExpiredInvitationIsRestricted(): void
    {
        $this->boot(true);
        $this->invite('late@example.com', '-1 day');
        $this->assertSame('registration_restricted', $this->identify('late@example.com')['body']['status']);
    }

    public function testInvalidEmailIsRejected(): void
    {
        $this->boot(false);
        $this->assertContains($this->identify('not-an-email')['status'], [400, 422]);
        $this->assertContains($this->identify(str_repeat('a', 250).'@example.com')['status'], [400, 422]);
    }

    public function testThrottledPerEmailAfterTenRequests(): void
    {
        $this->boot(false);
        for ($i = 0; $i < 10; ++$i) {
            $this->assertSame(200, $this->identify('limit@example.com')['status']);
        }
        $r = $this->identify('limit@example.com');
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertNotNull($this->client->getResponse()->headers->get('Retry-After'));
        $this->assertSame(200, $this->identify('other@example.com')['status']);
    }
}
