<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\OpaqueApi;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Rate limits of the unauthenticated auth endpoints (AuthRateLimiter) and the input length caps. The test
 * environment has per-IP limits of 100 per window (config/packages/test/rate_limiter.yaml), the per-address
 * limits are the production values; the limiter state is emptied before every test.
 */
class RateLimitTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive across tests (see AuthTest).
    }

    /** @return array{status: int, body: array<string, mixed>, retryAfter: ?string} */
    private function post(string $path, array $json, string $ip = '203.0.113.7'): array
    {
        self::$client->request('POST', $path, [], [], ['CONTENT_TYPE' => 'application/json', 'REMOTE_ADDR' => $ip], json_encode($json, JSON_THROW_ON_ERROR));
        $response = self::$client->getResponse();

        return [
            'status' => $response->getStatusCode(),
            'body' => json_decode((string) $response->getContent(), true) ?? [],
            'retryAfter' => $response->headers->get('Retry-After'),
        ];
    }

    /** Sign-up through OPAQUE; the answer of `finish`, or of `start` when that is refused. */
    private function signup(string $email, string $ip = '203.0.113.7'): array
    {
        self::$client->setServerParameter('REMOTE_ADDR', $ip);
        $r = OpaqueApi::signup(self::$client, 'Rita', $email, 'password123');

        return ['status' => $r['status'], 'body' => $r['body'] ?? [], 'retryAfter' => $r['headers']['retry-after'][0] ?? null];
    }

    private function assertRateLimited(array $r): void
    {
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertNotNull($r['retryAfter']);
        $this->assertGreaterThanOrEqual(1, (int) $r['retryAfter']);
        $this->assertLessThanOrEqual(3601, (int) $r['retryAfter']); // rate-limiter 8.1.11 rounds the remaining time up
    }

    private static function email(): string
    {
        return 'rl.'.bin2hex(random_bytes(4)).'@example.com';
    }

    public function testLoginIsThrottledPerEmailAfterFiveFailures(): void
    {
        $email = self::email();
        TestHelper::createUser(self::$em, self::$hasher, $email, 'password123');

        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(401, $this->post('/api/auth/login', ['email' => $email, 'password' => 'wrong-pass'])['status']);
        }
        $this->assertRateLimited($this->post('/api/auth/login', ['email' => $email, 'password' => 'wrong-pass']));
        // Even the right password is refused while the bucket is full, and case/whitespace variants share it.
        $this->assertRateLimited($this->post('/api/auth/login', ['email' => strtoupper($email), 'password' => 'password123'], '198.51.100.9'));
        // Another address from the same IP is unaffected.
        $this->assertSame(401, $this->post('/api/auth/login', ['email' => self::email(), 'password' => 'wrong-pass'])['status']);
    }

    public function testUnknownAddressIsThrottledLikeAKnownOne(): void
    {
        $email = self::email();
        $statuses = [];
        for ($i = 0; $i < 6; ++$i) {
            $statuses[] = $this->post('/api/auth/login', ['email' => $email, 'password' => 'wrong-pass'])['status'];
        }
        $this->assertSame([401, 401, 401, 401, 401, 429], $statuses);
    }

    public function testSuccessfulLoginsDoNotFillTheEmailBucketAndClearFailures(): void
    {
        $email = self::email();
        TestHelper::createUser(self::$em, self::$hasher, $email, 'password123');

        for ($round = 0; $round < 3; ++$round) {
            for ($i = 0; $i < 4; ++$i) {
                $this->assertSame(401, $this->post('/api/auth/login', ['email' => $email, 'password' => 'wrong-pass'])['status']);
            }
            $this->assertSame(200, $this->post('/api/auth/login', ['email' => $email, 'password' => 'password123'])['status']);
        }
    }

    public function testLoginIsThrottledPerIp(): void
    {
        $ip = '192.0.2.10';
        for ($i = 0; $i < 100; ++$i) {
            $this->assertSame(401, $this->post('/api/auth/login', ['email' => self::email(), 'password' => 'wrong-pass'], $ip)['status']);
        }
        $this->assertRateLimited($this->post('/api/auth/login', ['email' => self::email(), 'password' => 'wrong-pass'], $ip));
        $this->assertSame(401, $this->post('/api/auth/login', ['email' => self::email(), 'password' => 'wrong-pass'], '192.0.2.250')['status']);
    }

    public function testRegisterIsThrottledPerEmail(): void
    {
        $email = self::email();
        $statuses = [];
        for ($i = 0; $i < 4; ++$i) {
            $statuses[] = $this->signup($email);
        }
        $this->assertSame(201, $statuses[0]['status']);
        // the address exists now (email_taken), which counts against the bucket as well
        $this->assertSame(400, $statuses[1]['status']);
        $this->assertSame(400, $statuses[2]['status']);
        $this->assertRateLimited($statuses[3]);
        // Other addresses are unaffected.
        $this->assertSame(201, $this->signup(self::email())['status']);
    }

    public function testRegisterIsThrottledPerIp(): void
    {
        $ip = '192.0.2.20';
        for ($i = 0; $i < 100; ++$i) {
            $this->assertSame(201, $this->signup(self::email(), $ip)['status']);
        }
        $this->assertRateLimited($this->signup(self::email(), $ip));
    }

    public function testRefreshIsThrottledPerIp(): void
    {
        $ip = '192.0.2.30';
        $statuses = [];
        for ($i = 0; $i < 101; ++$i) {
            self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => 'not-a-token'], [], ['REMOTE_ADDR' => $ip]);
            $statuses[] = self::$client->getResponse()->getStatusCode();
        }
        $this->assertSame(401, $statuses[99]);
        $this->assertSame(429, $statuses[100]);
        $this->assertNotNull(self::$client->getResponse()->headers->get('Retry-After'));
    }

    public function testPasskeyOptionsAreCountedPerIpButStayGenerous(): void
    {
        for ($i = 0; $i < 20; ++$i) {
            self::$client->request('GET', '/api/auth/webauthn/authenticate/options', [], [], ['REMOTE_ADDR' => '203.0.113.99']);
            $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        }
    }

    public function testOverlongInputIsRejectedWithoutHashing(): void
    {
        $long = str_repeat('a', 129);
        $r = $this->post('/api/auth/login', ['email' => self::email(), 'password' => $long]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('password', $r['body']['field']);

        $r = $this->post('/api/auth/login', ['email' => str_repeat('a', 250).'@example.com', 'password' => 'password123']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('email', $r['body']['field']);

        $r = $this->signup(str_repeat('a', 250).'@example.com');
        $this->assertSame(422, $r['status']);
        $this->assertSame('email', $r['body']['field']);
    }
}
