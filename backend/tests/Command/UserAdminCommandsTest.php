<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\EmailChange;
use App\Entity\EmailVerification;
use App\Entity\PasswordReset;
use App\Entity\User;
use App\Entity\UserConsent;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** app:user:create, app:user:set-password, app:user:verify (alias app:user:activate). */
class UserAdminCommandsTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        self::$tokens = static::getContainer()->get(TokenService::class);
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

    private function command(string $name): CommandTester
    {
        return new CommandTester((new Application(self::$client->getKernel()))->find($name));
    }

    private function login(string $email, string $password): int
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => $email, 'password' => $password])['status'];
    }

    private function user(string $id): User
    {
        self::$em->clear();
        $user = self::$em->getRepository(User::class)->find($id);
        $this->assertInstanceOf(User::class, $user);

        return $user;
    }

    private function userByEmail(string $email): ?User
    {
        self::$em->clear();

        return self::$em->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    // --- app:user:create ---

    public function testCreateNonInteractiveCreatesAVerifiedUserWhoCanLogIn(): void
    {
        $t = $this->command('app:user:create');
        $code = $t->execute(['--name' => 'Ada', '--email' => 'ada@example.com', '--password' => 'secret-pass-1'], ['interactive' => false]);

        $this->assertSame(Command::SUCCESS, $code, $t->getDisplay());
        $user = $this->userByEmail('ada@example.com');
        $this->assertNotNull($user);
        $this->assertTrue($user->isEmailVerified());
        $this->assertSame('Ada', $user->getName());
        $this->assertStringContainsString($user->getId(), $t->getDisplay());
        $this->assertSame(0, self::$em->getRepository(UserConsent::class)->count([]));
        $this->assertSame(0, self::$em->getRepository(EmailVerification::class)->count([]));
        $this->assertSame(200, $this->login('ada@example.com', 'secret-pass-1'));
    }

    public function testCreateInteractiveAsksForNameAndEmailAndReasksInvalidValues(): void
    {
        $t = $this->command('app:user:create');
        $t->setInputs(['Grace', 'not-an-email', 'grace@example.com']);
        $code = $t->execute([]);

        $this->assertSame(Command::SUCCESS, $code, $t->getDisplay());
        $this->assertNotNull($this->userByEmail('grace@example.com'));
        $this->assertStringContainsString('/reset-password?token=', $t->getDisplay());
    }

    public function testCreateRejectsInvalidEmailAndShortPassword(): void
    {
        $t = $this->command('app:user:create');
        $this->assertSame(Command::FAILURE, $t->execute(['--name' => 'X', '--email' => 'nope', '--password' => 'secret-pass-1'], ['interactive' => false]));
        $this->assertStringContainsString('Invalid email', $t->getDisplay());

        $this->assertSame(Command::FAILURE, $t->execute(['--name' => 'X', '--email' => 'x@example.com', '--password' => 'short'], ['interactive' => false]));
        $this->assertStringContainsString('Invalid password', $t->getDisplay());
        $this->assertNull($this->userByEmail('x@example.com'));
    }

    public function testCreateRejectsADuplicateAddress(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'taken@example.com');
        $t = $this->command('app:user:create');
        $code = $t->execute(['--name' => 'X', '--email' => 'TAKEN@example.com', '--password' => 'secret-pass-1'], ['interactive' => false]);

        $this->assertSame(Command::FAILURE, $code);
        $this->assertStringContainsString('already exists', $t->getDisplay());
        $this->assertSame(1, self::$em->getRepository(User::class)->count([]));
    }

    public function testCreateNonInteractiveWithMissingValuesFails(): void
    {
        $t = $this->command('app:user:create');
        $this->assertSame(Command::FAILURE, $t->execute(['--email' => 'a@example.com', '--password' => 'secret-pass-1'], ['interactive' => false]));
        $this->assertStringContainsString('--name', $t->getDisplay());
        $this->assertSame(Command::FAILURE, $t->execute(['--name' => 'A', '--password' => 'secret-pass-1'], ['interactive' => false]));
        $this->assertStringContainsString('--email', $t->getDisplay());
        $this->assertSame(0, self::$em->getRepository(User::class)->count([]));
    }

    public function testCreateReadsThePasswordFromStdin(): void
    {
        $t = $this->command('app:user:create');
        $t->setInputs(["stdin-secret-1\n"]);
        $code = $t->execute(['--name' => 'Stan', '--email' => 'stan@example.com', '--password-stdin' => true], ['interactive' => false]);

        $this->assertSame(Command::SUCCESS, $code, $t->getDisplay());
        $this->assertSame(200, $this->login('stan@example.com', 'stdin-secret-1'));
    }

    public function testCreateRejectsPasswordAndPasswordStdinTogether(): void
    {
        $t = $this->command('app:user:create');
        $t->setInputs(["stdin-secret-1\n"]);
        $code = $t->execute(['--name' => 'A', '--email' => 'a@example.com', '--password' => 'secret-pass-1', '--password-stdin' => true], ['interactive' => false]);

        $this->assertSame(Command::FAILURE, $code);
        $this->assertStringContainsString('not both', $t->getDisplay());
        $this->assertNull($this->userByEmail('a@example.com'));
    }

    // --- app:user:set-password ---

    public function testSetPasswordByIdEndsSessionsAndVoidsResetsAndEmailChanges(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'sp@example.com', 'old-password-1');
        $refresh = self::$tokens->createRefreshToken($user);
        self::$em->persist(new PasswordReset($user, 'hash-1', new \DateTimeImmutable()));
        self::$em->persist(new EmailChange($user, 'new@example.com', 'hash-2', new \DateTimeImmutable()));
        self::$em->flush();

        $t = $this->command('app:user:set-password');
        $code = $t->execute(['user' => $user->getId(), '--password' => 'new-password-1'], ['interactive' => false]);

        $this->assertSame(Command::SUCCESS, $code, $t->getDisplay());
        $this->assertSame(200, $this->login('sp@example.com', 'new-password-1'));
        $this->assertSame(401, $this->login('sp@example.com', 'old-password-1'));
        $this->assertSame(1, $this->user($user->getId())->getTokenVersion());
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $refresh]);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
        $this->assertSame(0, self::$em->getRepository(PasswordReset::class)->count(['usedAt' => null]));
        $this->assertSame(0, self::$em->getRepository(EmailChange::class)->count([]));
    }

    public function testSetPasswordByEmailKeepsTheVerificationState(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'unv@example.com', 'old-password-1', false);

        $t = $this->command('app:user:set-password');
        $code = $t->execute(['user' => 'UNV@example.com', '--password' => 'new-password-1']);

        $this->assertSame(Command::SUCCESS, $code, $t->getDisplay());
        $this->assertFalse($this->user($user->getId())->isEmailVerified());
        // Unverified: a restricted session with the right password (not 401)
        $this->assertSame(200, $this->login('unv@example.com', 'new-password-1'));
        $this->assertSame(401, $this->login('unv@example.com', 'old-password-1'));
    }

    public function testSetPasswordFromStdinAndErrors(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'in@example.com', 'old-password-1');
        $t = $this->command('app:user:set-password');

        $t->setInputs(["from-stdin-1\n"]);
        $this->assertSame(Command::SUCCESS, $t->execute(['user' => $user->getId(), '--password-stdin' => true], ['interactive' => false]));
        $this->assertSame(200, $this->login('in@example.com', 'from-stdin-1'));

        $this->assertSame(Command::FAILURE, $t->execute(['user' => $user->getId(), '--password' => 'short'], ['interactive' => false]));
        $this->assertStringContainsString('Invalid password', $t->getDisplay());
        $this->assertSame(200, $this->login('in@example.com', 'from-stdin-1'));
        $this->assertSame(Command::SUCCESS, $t->execute(['user' => $user->getId()], ['interactive' => false]));
        $this->assertStringContainsString('/reset-password?token=', $t->getDisplay());
    }

    public function testSetPasswordUnknownUser(): void
    {
        $t = $this->command('app:user:set-password');
        $this->assertSame(Command::FAILURE, $t->execute(['user' => 'nobody@example.com', '--password' => 'new-password-1'], ['interactive' => false]));
        $this->assertSame(Command::FAILURE, $t->execute(['user' => '0190a1b2-0000-7000-8000-000000000000', '--password' => 'new-password-1'], ['interactive' => false]));
        $this->assertStringContainsString('No user', $t->getDisplay());
    }

    // --- app:user:verify / app:user:activate ---

    private function unverifiedWithCode(string $email): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email, 'password123', false);
        $verification = new EmailVerification();
        $verification->setUser($user)->setTokenHash(hash('sha256', uniqid()));
        self::$em->persist($verification);
        self::$em->flush();

        return $user;
    }

    public function testVerifyByIdRemovesPendingCodes(): void
    {
        $user = $this->unverifiedWithCode('v1@example.com');
        $t = $this->command('app:user:verify');

        $this->assertSame(Command::SUCCESS, $t->execute(['user' => $user->getId()]));
        $this->assertTrue($this->user($user->getId())->isEmailVerified());
        $this->assertSame(0, self::$em->getRepository(EmailVerification::class)->count([]));
        $this->assertSame(200, $this->login('v1@example.com', 'password123'));
    }

    public function testActivateAliasByEmailAndAlreadyVerified(): void
    {
        $user = $this->unverifiedWithCode('v2@example.com');
        $t = $this->command('app:user:activate');

        $this->assertSame(Command::SUCCESS, $t->execute(['user' => 'V2@example.com']));
        $this->assertTrue($this->user($user->getId())->isEmailVerified());
        $this->assertSame(0, self::$em->getRepository(EmailVerification::class)->count([]));

        $this->assertSame(Command::SUCCESS, $t->execute(['user' => 'v2@example.com']));
        $this->assertStringContainsString('already verified', $t->getDisplay());
    }

    public function testVerifyUnknownUser(): void
    {
        $t = $this->command('app:user:verify');
        $this->assertSame(Command::FAILURE, $t->execute(['user' => 'nobody@example.com']));
        $this->assertStringContainsString('No user', $t->getDisplay());
    }
}
