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
 * AUTH-03: `DELETE /api/auth/me` needs a step-up token (password, or the mailed code for accounts without a password).
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

    private function exists(string $email): bool
    {
        self::$em->clear();

        return null !== self::$em->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    /** Deletes with a valid step-up (password) unless `$stepUp` is false. @return array{status: int, content: string, body: mixed} */
    private function delete(User $user, bool $stepUp = true, ?string $auth = null): array
    {
        $auth ??= TestHelper::sessionHeader($user, self::$tokens);
        $token = $stepUp ? TestHelper::stepUp(self::$client, $auth) : null;

        return TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', [], $auth, $token);
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

    private function mailedCode(int $index = 0): string
    {
        $mail = $this->getMailerMessage($index);
        $this->assertInstanceOf(Email::class, $mail);
        $this->assertSame(1, preg_match('/letter-spacing:\d+px[^>]*>(\d{3})-(\d{3})</', (string) $mail->getHtmlBody(), $m));

        return $m[1].$m[2];
    }

    public function testWithoutStepUpNothingIsDeleted(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');

        $r = $this->delete($user, false);
        $this->assertSame(403, $r['status'], $r['content']);
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertTrue($this->exists('alice@example.com'));

        // A token of another user's session is refused as well
        $other = TestHelper::createUser(self::$em, self::$hasher, 'other@example.com');
        [, $foreign] = TestHelper::stepUpSession(self::$client, $other, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', [], TestHelper::sessionHeader($user, self::$tokens), $foreign);
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertTrue($this->exists('alice@example.com'));
    }

    public function testStepUpDeletesTheAccount(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->delete($user);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($this->exists('alice@example.com'));
    }

    public function testExpiredStepUpIsRefused(): void
    {
        self::mockTime('2026-10-13 09:00:00 UTC');
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        [$auth, $token] = TestHelper::stepUpSession(self::$client, $user, self::$tokens);
        self::mockTime('+11 minutes');
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', [], TestHelper::sessionHeader($user, self::$tokens), $token);
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertTrue($this->exists('alice@example.com'));
    }

    public function testLastMemberGuardStillApplies(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'solo@example.com');
        TestHelper::createClub(self::$em, $user);

        $r = $this->delete($user);
        $this->assertSame(422, $r['status'], $r['content']);
        $this->assertSame('last_member_of_club', $r['body']['code']);
        $this->assertTrue($this->exists('solo@example.com'));

        $this->assertSame('step_up_required', $this->delete($user, false)['body']['code']);
    }

    public function testMembershipsOfAnAccountWithOtherMembersAreRemoved(): void
    {
        $a = TestHelper::createUser(self::$em, self::$hasher, 'a@example.com');
        $b = TestHelper::createUser(self::$em, self::$hasher, 'b@example.com');
        $club = TestHelper::createClub(self::$em, $a);
        self::$em->persist((new ClubUser())->setClub($club)->setUser($b));
        self::$em->flush();
        $this->assertSame(200, $this->delete($a)['status']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
    }

    public function testAccountWithoutPasswordConfirmsWithTheMailedStepUpCode(): void
    {
        $user = $this->passwordless();
        $auth = TestHelper::sessionHeader($user, self::$tokens);

        $this->assertSame(204, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/step-up/code', [], $auth)['status']);
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'sso@example.com');
        $code = $this->mailedCode();
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/step-up', ['confirmationCode' => $code], $auth);
        $this->assertSame(200, $r['status'], $r['content']);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', [], $auth, $r['body']['stepUpToken']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertFalse($this->exists('sso@example.com'));
    }

    public function testObsoleteDeletionRoutesAndBodiesAreGone(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $auth = TestHelper::sessionHeader($user, self::$tokens);
        $this->assertSame(404, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/delete-account/code', [], $auth)['status']);
        // A password in the body is not a proof any more
        $this->assertSame('step_up_required', TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', ['password' => 'password123'], $auth)['body']['code']);
        $this->assertTrue($this->exists('alice@example.com'));
    }

    public function testRequestsWithoutTokenAreUnauthorized(): void
    {
        self::$client->request('DELETE', '/api/auth/me', [], [], ['CONTENT_TYPE' => 'application/json']);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
    }
}
