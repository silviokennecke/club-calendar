<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\ClubInvitation;
use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Service\ClubInvitationService;
use App\Service\RegistrationPolicy;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\OpaqueApi;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * RESTRICT_REGISTRATION: only addresses with an open (pending, not expired) club invitation may create an
 * account, by password or by a first SSO sign-in. Every test boots its own kernel with the policy replaced.
 */
class RestrictedRegistrationTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private FakeOAuth2Client $google;

    protected function boot(bool $restricted): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = static::getContainer();
        $container->set(RegistrationPolicy::class, new RegistrationPolicy($container->get(ClubInvitationService::class), $restricted));
        $this->google = new FakeOAuth2Client();
        $container->set('knpu.oauth2.client.google', $this->google);
        $this->em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    private function invite(string $email, string $status = ClubInvitation::PENDING, string $expiresIn = '+3 days'): void
    {
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $owner = TestHelper::createUser($this->em, $hasher, 'owner'.uniqid().'@example.com');
        $club = TestHelper::createClub($this->em, $owner);
        $now = new \DateTimeImmutable();
        $invitation = new ClubInvitation($club, $owner, $email, hash('sha256', $email.$status.$expiresIn), $now);
        if (ClubInvitation::PENDING !== $status) {
            $invitation->resolve($status, $now);
        }
        $this->em->persist($invitation);
        $this->em->flush();
        // expires_at has no setter: set it directly
        $this->em->getConnection()->executeStatement(
            'UPDATE club_invitation SET expires_at = ? WHERE id = ?',
            [(new \DateTimeImmutable($expiresIn, new \DateTimeZone('UTC')))->format('Y-m-d H:i:s'), $invitation->getId()],
        );
        $this->em->clear();
    }

    /** @return array{status: int, body: mixed} */
    private function register(string $email = 'new@example.com'): array
    {
        return OpaqueApi::signup($this->client, 'New', $email, 'password123');
    }

    private function userCount(string $email): int
    {
        $this->em->clear();

        return $this->em->getRepository(User::class)->count(['email' => $email]);
    }

    private function assertRestricted(array $r): void
    {
        $this->assertSame(403, $r['status']);
        $this->assertSame('registration_restricted', $r['body']['code']);
        $this->assertSame('email', $r['body']['field']);
    }

    /** @return array<string, string> query of the redirect to the frontend */
    private function sso(string $email, string $sub = 'google-1'): array
    {
        $this->client->getCookieJar()->clear();
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google?'.http_build_query(['code_challenge' => \App\Security\OneTimeTokenService::challengeFor(str_repeat('v', 43))]));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $q);
        $this->google->claims = ['sub' => $sub, 'email' => $email, 'email_verified' => true, 'name' => 'Google User'];
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google/callback?'.http_build_query(['code' => 'c', 'state' => $q['state'] ?? '']));
        $response = $this->client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        parse_str((string) parse_url((string) $response->headers->get('Location'), \PHP_URL_QUERY), $result);

        return $result;
    }

    public function testNotRestrictedRegistersAsBefore(): void
    {
        $this->boot(false);
        $this->assertSame(201, $this->register()['status']);
        $this->assertSame(1, $this->userCount('new@example.com'));
    }

    public function testRestrictedWithoutInvitationIsRefusedAndCreatesNoUser(): void
    {
        $this->boot(true);
        $this->assertRestricted($this->register());
        $this->assertSame(0, $this->userCount('new@example.com'));
    }

    public function testRestrictedWithPendingInvitationRegisters(): void
    {
        $this->boot(true);
        $this->invite('new@example.com');
        $this->assertSame(201, $this->register()['status']);
        $this->assertSame(1, $this->userCount('new@example.com'));
    }

    public function testInvitationMatchIsCaseInsensitive(): void
    {
        $this->boot(true);
        $this->invite('new@example.com');
        $this->assertSame(201, $this->register('New@Example.COM')['status']);
    }

    public function testExpiredInvitationDoesNotCount(): void
    {
        $this->boot(true);
        $this->invite('new@example.com', ClubInvitation::PENDING, '-1 minute');
        $this->assertRestricted($this->register());
    }

    public function testAcceptedAndDeclinedInvitationsDoNotCount(): void
    {
        $this->boot(true);
        $this->invite('new@example.com', ClubInvitation::ACCEPTED);
        $this->assertRestricted($this->register());
        $this->invite('other@example.com', ClubInvitation::DECLINED);
        $this->assertRestricted($this->register('other@example.com'));
    }

    public function testRegistrationEndpointReportsThePolicy(): void
    {
        $this->boot(false);
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/registration');
        $this->assertSame(200, $r['status']);
        $this->assertFalse($r['body']['restricted']);

        $this->boot(true);
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/registration');
        $this->assertTrue($r['body']['restricted']);
    }

    public function testSsoNewUserWithoutInvitationIsRedirectedAndNothingIsCreated(): void
    {
        $this->boot(true);
        $this->assertSame(['error' => 'registration_restricted'], $this->sso('g@example.com'));
        $this->assertSame(0, $this->userCount('g@example.com'));
        $this->assertSame(0, $this->em->getRepository(OAuthAccount::class)->count([]));
    }

    public function testSsoNewUserWithInvitationSignsIn(): void
    {
        $this->boot(true);
        $this->invite('g@example.com');
        $result = $this->sso('g@example.com');
        $this->assertArrayNotHasKey('error', $result);
        $this->assertNotEmpty($result['code']);
        $this->assertSame(1, $this->userCount('g@example.com'));
    }

    public function testSsoExistingUsersAreUnaffected(): void
    {
        $this->boot(true);
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        // Known provider account signs in again
        $user = TestHelper::createUser($this->em, $hasher, 'g@example.com');
        $this->em->persist((new OAuthAccount())->setUser($user)->setProvider('google')->setProviderId('google-1')->setEmail('g@example.com'));
        $this->em->flush();
        $this->assertArrayNotHasKey('error', $this->sso('g@example.com'));

        // An existing user with a verified address is still linked
        TestHelper::createUser($this->em, $hasher, 'linked@example.com');
        $this->assertArrayNotHasKey('error', $this->sso('linked@example.com', 'google-2'));
    }
}
