<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthAccount;
use App\Entity\Passkey;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\SoftwareAuthenticator;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * L7: passkey registration needs the password, or for accounts without one a mailed code of its own purpose.
 */
class PasskeyReauthTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
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
        // Keep the kernel alive across tests (see AuthTest).
    }

    private function auth(User $user): string
    {
        return 'Bearer '.self::$tokens->createAccessToken($user);
    }

    private function passwordless(string $email = 'sso@example.com'): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email);
        $user->setPassword(null);
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('google')->setProviderId('g-'.$email)->setEmail($email);
        self::$em->persist($account);
        self::$em->flush();

        return $user;
    }

    private function options(User $user, ?array $body): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/options', $body ?? [], $this->auth($user));
    }

    private function requestCode(User $user, string $path = '/api/auth/webauthn/register/code'): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', $path, [], $this->auth($user));
    }

    private function mailedCode(int $index = 0): string
    {
        $mail = $this->getMailerMessage($index);
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertSame(1, preg_match('/letter-spacing:\d+px[^>]*>(\d{6})</', (string) $mail->getHtmlBody(), $m));

        return $m[1];
    }

    private function verify(User $user, array $opts, ?string $token = null): array
    {
        $authenticator = new SoftwareAuthenticator();

        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $token ?? $opts['challengeToken'],
            'response' => $authenticator->attestation($opts['options']['challenge'], rtrim((string) $_ENV['FRONTEND_URL'], '/'), 'localhost'),
            'deviceName' => 'Software',
        ], $this->auth($user));
    }

    private function passkeyCount(): int
    {
        self::$em->clear();

        return count(self::$em->getRepository(Passkey::class)->findAll());
    }

    public function testOptionsWithoutOrWithWrongPasswordAreRefused(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');

        foreach ([null, [], ['password' => ''], ['password' => 'wrong-password'], ['code' => '123456']] as $body) {
            $r = $this->options($user, $body);
            $this->assertSame(400, $r['status'], $r['content']);
            $this->assertSame('invalid_credentials', $r['body']['code']);
            $this->assertSame('password', $r['body']['field']);
        }
        $this->assertSame(0, $this->passkeyCount());
    }

    public function testVerifyCannotBeCalledWithoutTokenFromOptions(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => 'forged',
            'response' => ['id' => 'x'],
        ], $this->auth($user));
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_passkey_registration', $r['body']['code']);
        $this->assertSame(0, $this->passkeyCount());
    }

    public function testPasswordAccountRegistersWithPassword(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->options($user, ['password' => 'password123']);
        $this->assertSame(200, $r['status'], $r['content']);
        $v = $this->verify($user, $r['body']);
        $this->assertSame(200, $v['status'], $v['content']);
        $this->assertSame(1, $this->passkeyCount());
    }

    public function testPasswordAccountCannotRequestCode(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->requestCode($user);
        $this->assertSame(409, $r['status']);
        $this->assertSame('has_password', $r['body']['code']);
    }

    public function testPasswordlessAccountNeedsMailedCode(): void
    {
        $user = $this->passwordless();

        foreach ([null, ['password' => 'password123'], ['code' => ''], ['code' => '000000']] as $body) {
            $r = $this->options($user, $body);
            $this->assertSame(400, $r['status'], $r['content']);
            $this->assertSame('invalid_confirmation_code', $r['body']['code']);
            $this->assertSame('code', $r['body']['field']);
        }

        $this->assertSame(204, $this->requestCode($user)['status']);
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'sso@example.com');
        $code = $this->mailedCode();

        $r = $this->options($user, ['code' => $code]);
        $this->assertSame(200, $r['status'], $r['content']);
        $v = $this->verify($user, $r['body']);
        $this->assertSame(200, $v['status'], $v['content']);
        $this->assertSame(1, $this->passkeyCount());
    }

    public function testDeletionCodeIsNotValidForPasskeysAndViceVersa(): void
    {
        self::mockTime('2026-10-13 09:00:00 UTC');
        $user = $this->passwordless();

        $this->assertSame(204, $this->requestCode($user, '/api/auth/delete-account/code')['status']);
        $deleteCode = $this->mailedCode();
        $this->assertSame(204, $this->requestCode($user)['status']);
        $passkeyCode = $this->mailedCode();
        $this->assertNotSame($deleteCode, $passkeyCode);

        $r = $this->options($user, ['code' => $deleteCode]);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_confirmation_code', $r['body']['code']);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', ['code' => $passkeyCode], $this->auth($user));
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_confirmation_code', $r['body']['code']);
        $this->assertNotNull(self::$em->getRepository(User::class)->findOneBy(['email' => 'sso@example.com']));
    }

    public function testAttemptsAreRateLimited(): void
    {
        $user = $this->passwordless();
        for ($i = 0; $i < 90; ++$i) {
            $this->assertSame(400, $this->options($user, ['code' => sprintf('%06d', $i)])['status']);
        }
        $r = $this->options($user, ['code' => '999999']);
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertSame(0, $this->passkeyCount());
    }

    public function testCodeMailsAreRateLimited(): void
    {
        $user = $this->passwordless();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(204, $this->requestCode($user)['status']);
        }
        $r = $this->requestCode($user);
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }
}
