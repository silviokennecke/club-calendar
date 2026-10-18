<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\ClubUser;
use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * AUTH-03: `DELETE /api/auth/me` needs re-authentication (password, or the mailed code for accounts
 * without a password).
 */
class AccountDeletionTest extends WebTestCase
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

    private function exists(string $email): bool
    {
        self::$em->clear();

        return null !== self::$em->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    /** @return array{status: int, content: string, body: mixed} */
    private function delete(User $user, ?array $body, array $server = []): array
    {
        self::$client->request('DELETE', '/api/auth/me', [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_AUTHORIZATION' => $this->auth($user),
        ] + $server, null === $body ? null : (string) json_encode($body));
        $response = self::$client->getResponse();

        return [
            'status' => $response->getStatusCode(),
            'content' => (string) $response->getContent(),
            'body' => json_decode((string) $response->getContent(), true),
        ];
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

    private function requestCode(User $user): array
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/delete-account/code', [], $this->auth($user));
    }

    private function mailedCode(int $index = 0): string
    {
        $mail = $this->getMailerMessage($index);
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertSame(1, preg_match('/letter-spacing:10px[^>]*>(\d{6})</', (string) $mail->getHtmlBody(), $m));

        return $m[1];
    }

    public function testWithoutCredentialsNothingIsDeleted(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');

        foreach ([null, [], ['password' => ''], ['password' => null], ['code' => '123456']] as $body) {
            $r = $this->delete($user, $body);
            $this->assertSame(400, $r['status'], $r['content']);
            $this->assertSame('invalid_credentials', $r['body']['code']);
            $this->assertSame('password', $r['body']['field']);
        }
        $this->assertTrue($this->exists('alice@example.com'));
    }

    public function testWrongPasswordIsRefused(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->delete($user, ['password' => 'wrong-password']);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
        $this->assertTrue($this->exists('alice@example.com'));
    }

    public function testRightPasswordDeletesTheAccount(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->delete($user, ['password' => 'password123']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($this->exists('alice@example.com'));
    }

    public function testWrongPasswordAttemptsAreRateLimited(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(400, $this->delete($user, ['password' => 'nope'.$i])['status']);
        }
        // Even the right password is refused once the bucket of the user is used up.
        $r = $this->delete($user, ['password' => 'password123']);
        $this->assertSame(429, $r['status'], $r['content']);
        $this->assertSame('rate_limited', $r['body']['code']);
        $this->assertNotNull(self::$client->getResponse()->headers->get('Retry-After'));
        $this->assertTrue($this->exists('alice@example.com'));
    }

    public function testLastMemberGuardStillApplies(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'solo@example.com');
        TestHelper::createClub(self::$em, $user);

        $r = $this->delete($user, ['password' => 'password123']);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_member_of_club', $r['body']['code']);
        $this->assertTrue($this->exists('solo@example.com'));

        // A wrong password is refused before the guard answers (no information for the unauthenticated)
        $r = $this->delete($user, ['password' => 'wrong']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
    }

    public function testMembershipsOfAnAccountWithOtherMembersAreRemoved(): void
    {
        $a = TestHelper::createUser(self::$em, self::$hasher, 'a@example.com');
        $b = TestHelper::createUser(self::$em, self::$hasher, 'b@example.com');
        $club = TestHelper::createClub(self::$em, $a);
        self::$em->persist((new ClubUser())->setClub($club)->setUser($b));
        self::$em->flush();
        $this->assertSame(200, $this->delete($a, ['password' => 'password123'])['status']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
    }

    public function testAccountWithoutPasswordNeedsTheMailedCode(): void
    {
        $user = $this->passwordless();

        // Four refusals: the fifth attempt would be the last of the 5 per 15 minutes
        foreach ([null, ['password' => 'password123'], ['code' => ''], ['code' => '000000']] as $body) {
            $r = $this->delete($user, $body);
            $this->assertSame(400, $r['status'], $r['content']);
            $this->assertSame('invalid_confirmation_code', $r['body']['code']);
            $this->assertSame('code', $r['body']['field']);
        }
        $this->assertTrue($this->exists('sso@example.com'));

        $this->assertSame(204, $this->requestCode($user)['status']);
        $this->assertEmailCount(1);
        $mail = $this->getMailerMessage();
        $this->assertEmailAddressContains($mail, 'to', 'sso@example.com');
        $code = $this->mailedCode();

        $r = $this->delete($user, ['code' => $code]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($this->exists('sso@example.com'));
    }

    public function testCodeOfAnotherAccountOrAnExpiredCodeIsRefused(): void
    {
        self::mockTime('2026-10-13 09:00:00 UTC');
        $one = $this->passwordless('one@example.com');
        $two = $this->passwordless('two@example.com');
        $this->requestCode($one);
        $codeOne = $this->mailedCode();

        $this->assertSame(400, $this->delete($two, ['code' => $codeOne])['status']);

        self::mockTime('+25 minutes');
        $r = $this->delete($one, ['code' => $codeOne]);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertSame('invalid_confirmation_code', $r['body']['code']);
        $this->assertTrue($this->exists('one@example.com'));
        $this->assertTrue($this->exists('two@example.com'));
    }

    public function testCodeEndsWhenTheSessionsEnd(): void
    {
        $user = $this->passwordless();
        $this->requestCode($user);
        $code = $this->mailedCode();
        $user = self::$em->getRepository(User::class)->find($user->getId());
        $user->invalidateTokens();
        self::$em->flush();
        $access = 'Bearer '.self::$tokens->createAccessToken($user);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', ['code' => $code], $access);
        $this->assertSame(400, $r['status'], $r['content']);
        $this->assertTrue($this->exists('sso@example.com'));
    }

    public function testGuessingTheCodeIsRateLimited(): void
    {
        $user = $this->passwordless();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(400, $this->delete($user, ['code' => sprintf('%06d', $i)])['status']);
        }
        $r = $this->delete($user, ['code' => '999999']);
        $this->assertSame(429, $r['status'], $r['content']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }

    public function testCodeMailsAreLimitedAndOnlyForAccountsWithoutPassword(): void
    {
        $withPassword = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->requestCode($withPassword);
        $this->assertSame(409, $r['status'], $r['content']);
        $this->assertSame('has_password', $r['body']['code']);
        $this->assertEmailCount(0);

        $user = $this->passwordless();
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(204, $this->requestCode($user)['status']);
        }
        $r = $this->requestCode($user);
        $this->assertSame(429, $r['status'], $r['content']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }

    public function testRequestsWithoutTokenAreUnauthorized(): void
    {
        self::$client->request('DELETE', '/api/auth/me', [], [], ['CONTENT_TYPE' => 'application/json'], '{"password":"x"}');
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
        self::$client->request('POST', '/api/auth/delete-account/code');
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
    }
}
