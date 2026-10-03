<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Passkey;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class AuthTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
        // Intentionally skip parent::tearDown() to keep the kernel alive across tests.
        // This ensures static::getContainer() and self::$client share the same kernel,
        // which is required for MailerAssertionsTrait to see email events captured during requests.
    }

    // --- Register ---

    public function testRegisterReturns202AndCheckYourEmailMessage(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Alice', 'email' => 'alice@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(202, $r['status']);
        $this->assertSame('check_your_email', $r['body']['message']);
        $this->assertArrayNotHasKey('access_token', $r['body']);
    }

    public function testRegisterSendsVerificationEmail(): void
    {
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'Bob', 'email' => 'bob@example.com', 'password' => 'password123',
        ]);
        $this->assertEmailCount(1);
        $email = $this->getMailerMessage();
        $this->assertEmailAddressContains($email, 'to', 'bob@example.com');
    }

    // --- Login ---

    public function testLoginReturns422ForInvalidBody(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'not-an-email', 'password' => '',
        ]);
        $this->assertSame(422, $r['status']);
    }

    public function testLoginReturns401ForUnknownEmail(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'nobody@example.com', 'password' => 'anything',
        ]);
        $this->assertSame(401, $r['status']);
    }

    public function testLoginReturns401ForWrongPassword(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'alice@example.com', 'password' => 'wrong',
        ]);
        $this->assertSame(401, $r['status']);
    }

    public function testLoginReturns403ForUnverifiedUser(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'unverified@example.com', 'password123', false);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'unverified@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(403, $r['status']);
        $this->assertSame('email_not_verified', $r['body']['error']);
    }

    public function testLoginReturnsTokensForVerifiedUser(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'bob@example.com', 'password' => 'password123',
        ]);
        $this->assertSame(200, $r['status']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);
        $this->assertSame('Bearer', $r['body']['token_type']);
    }

    // --- Resend verification ---

    public function testResendVerificationReturns204ForUnknownEmail(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'nobody@example.com',
        ]);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(0);
    }

    public function testResendVerificationReturns204ForAlreadyVerifiedEmail(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'verified@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'verified@example.com',
        ]);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(0);
    }

    public function testResendVerificationSendsEmailForUnverifiedUser(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'unverified@example.com', 'password123', false);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/resend-verification', [
            'email' => 'unverified@example.com',
        ]);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'unverified@example.com');
    }

    // --- Verify email ---

    public function testVerifyEmailRedirectsToFrontendOnInvalidToken(): void
    {
        self::$client->request('GET', '/api/auth/verify-email?id=bad-id&token=bad-token');
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        $location = $response->headers->get('Location');
        $this->assertStringContainsString('status=error', $location);
        $this->assertStringContainsString('reason=invalid', $location);
    }

    public function testVerifyEmailRedirectsToFrontendOnSuccess(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'verify@example.com', 'password123', false);

        // Insert EmailVerification via raw SQL to avoid Doctrine UoW state pollution.
        // Use bcrypt cost 4 (minimum) so the test runs fast.
        $rawVerifier = 'test-raw-verifier-abc123';
        $evId = \Symfony\Component\Uid\Uuid::v7()->toRfc4122();
        $tokenHash = password_hash($rawVerifier, \PASSWORD_BCRYPT, ['cost' => 4]);
        $expiresAt = (new \DateTimeImmutable('+24 hours'))->format('Y-m-d H:i:s');
        self::$em->getConnection()->executeStatement(
            'INSERT INTO email_verification (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
            [$evId, $user->getId(), $tokenHash, $expiresAt],
        );

        self::$client->request('GET', '/api/auth/verify-email?id='.$evId.'&token='.$rawVerifier);
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        $location = $response->headers->get('Location');
        $this->assertStringContainsString('status=success', $location);

        self::$em->clear();
        $refreshed = self::$em->find(\App\Entity\User::class, $user->getId());
        $this->assertNotNull($refreshed);
        $this->assertTrue($refreshed->isEmailVerified());
    }

    // --- Existing tests ---

    public function testMeReturns401WithoutToken(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me');
        $this->assertSame(401, $r['status']);
    }

    public function testMeReturnsUserForValidToken(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'carol@example.com');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame('carol@example.com', $r['body']['email']);
    }

    public function testMeListsPasskeysOfAUserLoadedFromTheDatabase(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'passkey@example.com');
        $passkey = (new Passkey())
            ->setId('pk-1')
            ->setUser($user)
            ->setCredentialId('credential-1')
            ->setPublicKey('binary-public-key')
            ->setDeviceName('Büro-PC');
        self::$em->persist($passkey);
        self::$em->flush();
        // The blob column is hydrated as a stream: load the passkey fresh from the database.
        self::$em->clear();

        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertCount(1, $r['body']['passkeys']);
        $this->assertSame('Büro-PC', $r['body']['passkeys'][0]['deviceName']);

        $loaded = self::$em->getRepository(Passkey::class)->find('pk-1');
        $this->assertSame('binary-public-key', $loaded->getPublicKey());
        // Reading twice must give the same bytes.
        $this->assertSame('binary-public-key', $loaded->getPublicKey());
    }

    public function testUpdateMePersistsLanguage(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'lang@example.com');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['language' => 'de'], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame('de', $r['body']['language']);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth);
        $this->assertSame('de', $r['body']['language']);
    }

    public function testUpdateMeRejectsUnsupportedLanguage(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'lang2@example.com');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['language' => 'xx'], $auth);
        $this->assertSame(422, $r['status']);
    }

    public function testTokenRefreshReturnsNewAccessToken(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'dave@example.com');
        $loginRes = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'dave@example.com', 'password' => 'password123',
        ]);
        $refreshToken = $loginRes['body']['refresh_token'];

        self::$client->request('POST', '/api/auth/token', [
            'grant_type' => 'refresh_token',
            'refresh_token' => $refreshToken,
        ], [], ['CONTENT_TYPE' => 'application/x-www-form-urlencoded']);
        $response = self::$client->getResponse();
        $this->assertSame(200, $response->getStatusCode());
        $body = json_decode((string) $response->getContent(), true);
        $this->assertNotEmpty($body['access_token']);
    }

    public function testLogoutReturnsOk(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout');
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['ok']);
    }

    public function testProvidersReturnsArrayOfProviderObjects(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/providers');
        $this->assertSame(200, $r['status']);
        $this->assertIsArray($r['body']);
        foreach ($r['body'] as $provider) {
            $this->assertArrayHasKey('id', $provider);
            $this->assertArrayHasKey('name', $provider);
            $this->assertArrayHasKey('icon', $provider);
        }
    }
}
