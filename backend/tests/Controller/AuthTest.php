<?php
declare(strict_types=1);

namespace App\Tests\Controller;

use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Exception as DBALException;
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
        $container    = static::getContainer();
        self::$em     = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    /**
     * @throws DBALException
     */
    protected function setUp(): void
    {
        DatabaseResetter::reset(self::$em);
    }

    public function testLoginReturns400ForInvalidBody(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'not-an-email', 'password' => '',
        ]);
        $this->assertSame(400, $r['status']);
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

    public function testLoginReturnsTokensForValidCredentials(): void
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

    public function testMeReturns401WithoutToken(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me');
        $this->assertSame(401, $r['status']);
    }

    public function testMeReturnsUserForValidToken(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'carol@example.com');
        $auth = TestHelper::authHeader($user, self::$tokens);
        $r    = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame('carol@example.com', $r['body']['email']);
    }

    public function testTokenRefreshReturnsNewAccessToken(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'dave@example.com');
        $loginRes = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', [
            'email' => 'dave@example.com', 'password' => 'password123',
        ]);
        $refreshToken = $loginRes['body']['refresh_token'];

        self::$client->request('POST', '/api/auth/token', [
            'grant_type'    => 'refresh_token',
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
}
