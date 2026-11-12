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
 * L7: passkey registration needs a step-up token (password, or the mailed code for accounts without a password).
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

    /** @return array{0: string, 1: string} Authorization header, step-up token (password or mailed code) */
    private function session(User $user): array
    {
        $auth = TestHelper::sessionHeader($user, self::$tokens);
        if (null !== $user->getPassword()) {
            return [$auth, TestHelper::stepUp(self::$client, $auth)];
        }
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/step-up/code', [], $auth);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/step-up', ['confirmationCode' => $this->mailedCode()], $auth);
        $this->assertSame(200, $r['status'], $r['content']);

        return [$auth, $r['body']['stepUpToken']];
    }

    private function mailedCode(int $index = 0): string
    {
        $mail = $this->getMailerMessage($index);
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertSame(1, preg_match('/letter-spacing:\d+px[^>]*>(\d{3})-(\d{3})</', (string) $mail->getHtmlBody(), $m));

        return $m[1].$m[2];
    }

    private function verify(string $auth, ?string $stepUp, array $opts, ?string $token = null): array
    {
        $authenticator = new SoftwareAuthenticator();

        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $token ?? $opts['challengeToken'],
            'response' => $authenticator->attestation($opts['options']['challenge'], rtrim((string) $_ENV['FRONTEND_URL'], '/'), 'localhost'),
            'deviceName' => 'Software',
        ], $auth, $stepUp);
    }

    private function passkeyCount(): int
    {
        self::$em->clear();

        return count(self::$em->getRepository(Passkey::class)->findAll());
    }

    public function testOptionsAndVerifyNeedAStepUp(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $auth = TestHelper::sessionHeader($user, self::$tokens);
        [, $foreign] = $this->session(TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com'));

        foreach ([null, $foreign, 'garbage'] as $token) {
            foreach (['options', 'verify'] as $step) {
                $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/'.$step, ['password' => 'password123'], $auth, $token);
                $this->assertSame(403, $r['status'], $r['content']);
                $this->assertSame('step_up_required', $r['body']['code']);
            }
        }
        $this->assertSame(0, $this->passkeyCount());
    }

    public function testVerifyCannotBeCalledWithoutTokenFromOptions(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        [$auth, $stepUp] = $this->session($user);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => 'forged',
            'response' => ['id' => 'x'],
        ], $auth, $stepUp);
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_passkey_registration', $r['body']['code']);
        $this->assertSame(0, $this->passkeyCount());
    }

    public function testPasswordAccountRegistersWithAStepUp(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        [$auth, $stepUp] = $this->session($user);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/options', [], $auth, $stepUp);
        $this->assertSame(200, $r['status'], $r['content']);
        $v = $this->verify($auth, $stepUp, $r['body']);
        $this->assertSame(200, $v['status'], $v['content']);
        $this->assertSame(1, $this->passkeyCount());
    }

    public function testPasswordlessAccountRegistersWithTheMailedStepUpCode(): void
    {
        $user = $this->passwordless();
        [$auth, $stepUp] = $this->session($user);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/options', [], $auth, $stepUp);
        $this->assertSame(200, $r['status'], $r['content']);
        $v = $this->verify($auth, $stepUp, $r['body']);
        $this->assertSame(200, $v['status'], $v['content']);
        $this->assertSame(1, $this->passkeyCount());
    }

    public function testObsoleteCodeRouteIsGone(): void
    {
        $user = $this->passwordless();
        $this->assertSame(404, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/code', [], TestHelper::sessionHeader($user, self::$tokens))['status']);
    }
}
