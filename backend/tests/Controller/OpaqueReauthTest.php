<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Enum\LegalDocumentType;
use App\Opaque\Base64Url;
use App\Opaque\OpaqueReauthTickets;
use App\Opaque\OpaqueService;
use App\Service\ReauthenticationService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use App\Tests\Opaque\OpaqueTestClient;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** OPAQUE reauth (`/api/auth/opaque/reauth/*`) and its consumers: delete account, passkey options, change e-mail. */
class OpaqueReauthTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string PASSWORD = 'correct horse battery';
    private const string START = '/api/auth/opaque/reauth/start';
    private const string FINISH = '/api/auth/opaque/reauth/finish';

    private KernelBrowser $client;
    private OpaqueTestClient $opaque;
    private ?string $previousEnabled = null;

    protected function setUp(): void
    {
        $this->previousEnabled = $_SERVER['OPAQUE_ENABLED'] ?? null;
        $this->setEnabled('true');
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->opaque = new OpaqueTestClient();
        DatabaseResetter::reset($this->em());
    }

    protected function tearDown(): void
    {
        static::mockTime(false);
        $this->setEnabled($this->previousEnabled);
    }

    private function setEnabled(?string $value): void
    {
        if (null === $value) {
            unset($_SERVER['OPAQUE_ENABLED'], $_ENV['OPAQUE_ENABLED']);
            putenv('OPAQUE_ENABLED');

            return;
        }
        $_SERVER['OPAQUE_ENABLED'] = $_ENV['OPAQUE_ENABLED'] = $value;
        putenv('OPAQUE_ENABLED='.$value);
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    private function service(string $class): object
    {
        return static::getContainer()->get($class);
    }

    private function reload(string $id): User
    {
        $this->em()->clear();

        return $this->em()->find(User::class, $id);
    }

    private function addRecord(User $user): void
    {
        $service = $this->service(OpaqueService::class);
        $reg = $this->opaque->startRegistration(self::PASSWORD);
        $service->storeRecord($user, $this->opaque->finishRegistration(self::PASSWORD, $reg['blind'], $service->registrationResponse($user, $reg['request']))['record']);
        $this->em()->flush();
    }

    /** Record only, no bcrypt hash. */
    private function opaqueUser(string $email = 'ada@example.com', bool $verified = true): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified($verified);
        $this->em()->persist($user);
        $this->addRecord($user);

        return $user;
    }

    /** bcrypt hash and record (after the upgrade). */
    private function upgradedUser(string $email = 'ada@example.com'): User
    {
        $user = TestHelper::createUser($this->em(), $this->service(UserPasswordHasherInterface::class), $email, self::PASSWORD);
        $this->addRecord($user);

        return $user;
    }

    private function legacyUser(string $email = 'ada@example.com'): User
    {
        return TestHelper::createUser($this->em(), $this->service(UserPasswordHasherInterface::class), $email, self::PASSWORD);
    }

    private function ssoUser(string $email = 'sso@example.com'): User
    {
        $user = TestHelper::createUser($this->em(), $this->service(UserPasswordHasherInterface::class), $email);
        $user->setPassword(null);
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('google')->setProviderId('g-'.$email)->setEmail($email);
        $this->em()->persist($account);
        $this->em()->flush();

        return $user;
    }

    private function bearer(User $user, ?bool $consentOk = null): string
    {
        return 'Bearer '.$this->service(TokenService::class)->createAccessToken($this->reload($user->getId()), $consentOk);
    }

    /** @return array{status: int, body: mixed} */
    private function call(string $method, string $path, array $body, string $auth = ''): array
    {
        return TestHelper::jsonRequest($this->client, $method, $path, $body, $auth);
    }

    /** Full reauth; returns the ticket, or the failing response. */
    private function reauth(User $user, string $purpose, string $auth, string $password = self::PASSWORD): string|array
    {
        $ke1 = $this->opaque->startLogin($password);
        $start = $this->call('POST', self::START, ['purpose' => $purpose, 'startLoginRequest' => Base64Url::encode($ke1['ke1'])], $auth);
        if (200 !== $start['status']) {
            return $start;
        }
        $result = $this->opaque->finishLogin($password, $ke1, Base64Url::decode($start['body']['loginResponse']) ?? '');
        $ke3 = null !== $result ? $result['ke3'] : random_bytes(64);
        $finish = $this->call('POST', self::FINISH, ['purpose' => $purpose, 'loginState' => $start['body']['loginState'], 'finishLoginRequest' => Base64Url::encode($ke3)], $auth);

        return 200 === $finish['status'] ? $finish['body']['reauthTicket'] : $finish;
    }

    private function exists(string $email): bool
    {
        $this->em()->clear();

        return null !== $this->em()->getRepository(User::class)->findOneBy(['email' => $email]);
    }

    private function ticketFor(User $user, string $purpose): string
    {
        return $this->service(OpaqueReauthTickets::class)->issue($this->reload($user->getId()), $purpose);
    }

    // --- endpoints ---

    public function testFinishReturnsATicketWithExpiry(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ke1 = $this->opaque->startLogin(self::PASSWORD);
        $start = $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => Base64Url::encode($ke1['ke1'])], $auth);
        $this->assertSame(200, $start['status']);
        $this->assertArrayHasKey('ksfProfile', $start['body']);
        $result = $this->opaque->finishLogin(self::PASSWORD, $ke1, Base64Url::decode($start['body']['loginResponse']));
        $finish = $this->call('POST', self::FINISH, ['purpose' => 'change-email', 'loginState' => $start['body']['loginState'], 'finishLoginRequest' => Base64Url::encode($result['ke3'])], $auth);
        $this->assertSame(200, $finish['status']);
        $this->assertSame(300, $finish['body']['expiresIn']);
        $this->assertNotSame('', $finish['body']['reauthTicket']);
    }

    public function testJwtIsRequired(): void
    {
        $this->assertSame(401, $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => 'x'])['status']);
        $this->assertSame(401, $this->call('POST', self::FINISH, ['purpose' => 'change-email', 'loginState' => 'x', 'finishLoginRequest' => 'x'])['status']);
    }

    public function testUnknownPurposeAndBadMessage(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ke1 = Base64Url::encode($this->opaque->startLogin(self::PASSWORD)['ke1']);
        $r = $this->call('POST', self::START, ['purpose' => 'launch-missiles', 'startLoginRequest' => $ke1], $auth);
        $this->assertSame(400, $r['status']);
        $this->assertSame('purpose', $r['body']['field']);
        $r = $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => 'AAAA'], $auth);
        $this->assertSame('invalid_opaque_message', $r['body']['code']);
    }

    public function testAccountWithoutRecordGets409(): void
    {
        foreach ([$this->legacyUser(), $this->ssoUser()] as $user) {
            $r = $this->reauth($user, 'delete-account', $this->bearer($user));
            $this->assertIsArray($r);
            $this->assertSame(409, $r['status']);
            $this->assertSame('opaque_not_registered', $r['body']['code']);
        }
    }

    public function testWrongPasswordIsInvalidCredentials(): void
    {
        $user = $this->opaqueUser();
        $r = $this->reauth($user, 'change-email', $this->bearer($user), 'wrong password');
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
        $this->assertSame('password', $r['body']['field']);
    }

    public function testStateIsBoundToPurposeAndSingleUse(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ke1 = $this->opaque->startLogin(self::PASSWORD);
        $start = $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => Base64Url::encode($ke1['ke1'])], $auth);
        $ke3 = Base64Url::encode($this->opaque->finishLogin(self::PASSWORD, $ke1, Base64Url::decode($start['body']['loginResponse']))['ke3']);
        $body = ['loginState' => $start['body']['loginState'], 'finishLoginRequest' => $ke3];

        $wrong = $this->call('POST', self::FINISH, $body + ['purpose' => 'delete-account'], $auth);
        $this->assertSame('invalid_credentials', $wrong['body']['code']);
        // a wrong-purpose attempt fails before the nonce is consumed; the right purpose then works exactly once
        $this->assertSame(200, $this->call('POST', self::FINISH, $body + ['purpose' => 'change-email'], $auth)['status']);
        $this->assertSame(400, $this->call('POST', self::FINISH, $body + ['purpose' => 'change-email'], $auth)['status']);
    }

    public function testStateOfAnotherUserIsRefused(): void
    {
        $ada = $this->opaqueUser('ada@example.com');
        $bob = $this->opaqueUser('bob@example.com');
        $ke1 = $this->opaque->startLogin(self::PASSWORD);
        $start = $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => Base64Url::encode($ke1['ke1'])], $this->bearer($ada));
        $ke3 = Base64Url::encode($this->opaque->finishLogin(self::PASSWORD, $ke1, Base64Url::decode($start['body']['loginResponse']))['ke3']);
        $r = $this->call('POST', self::FINISH, ['purpose' => 'change-email', 'loginState' => $start['body']['loginState'], 'finishLoginRequest' => $ke3], $this->bearer($bob));
        $this->assertSame(400, $r['status']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
    }

    public function testFlagOffIs503AndConsumersBehaveAsBefore(): void
    {
        $user = $this->legacyUser();
        $auth = $this->bearer($user);
        $this->setEnabled('false');
        foreach ([self::START, self::FINISH] as $path) {
            $r = $this->call('POST', $path, ['purpose' => 'change-email', 'startLoginRequest' => 'x', 'loginState' => 'x', 'finishLoginRequest' => 'x'], $auth);
            $this->assertSame(503, $r['status']);
            $this->assertSame('opaque_unavailable', $r['body']['code']);
        }
        $this->assertSame(200, $this->call('DELETE', '/api/auth/me', ['password' => self::PASSWORD], $auth)['status']);
    }

    public function testStartCountsAgainstLoginAndPurposeLimits(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ke1 = Base64Url::encode($this->opaque->startLogin(self::PASSWORD)['ke1']);
        // change-email: only the login limits (5 per address)
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(200, $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => $ke1], $auth)['status']);
        }
        $r = $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => $ke1], $auth);
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }

    public function testDeleteAccountPurposeLimitIsChecked(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ke1 = Base64Url::encode($this->opaque->startLogin(self::PASSWORD)['ke1']);
        // 5 deletion attempts via password-less bodies exhaust the purpose bucket; the reauth start then hits it
        // (the login bucket is untouched by them).
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(409, $this->call('DELETE', '/api/auth/me', ['password' => 'x'], $auth)['status']);
        }
        $r = $this->call('POST', self::START, ['purpose' => 'delete-account', 'startLoginRequest' => $ke1], $auth);
        $this->assertSame(429, $r['status']);
    }

    public function testPasskeyPurposeLimitIsChecked(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ke1 = Base64Url::encode($this->opaque->startLogin(self::PASSWORD)['ke1']);
        for ($i = 0; $i < 90; ++$i) { // test env limit
            $this->call('POST', '/api/auth/webauthn/register/options', ['password' => 'x'], $auth);
        }
        $this->assertSame(429, $this->call('POST', self::START, ['purpose' => 'passkey-register', 'startLoginRequest' => $ke1], $auth)['status']);
    }

    // --- delete account ---

    public function testOpaqueOnlyAccountDeletesWithTicket(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ticket = $this->reauth($user, 'delete-account', $auth);
        $this->assertIsString($ticket);
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth);
        $this->assertSame(200, $r['status'], $r['content'] ?? '');
        $this->assertFalse($this->exists('ada@example.com'));
    }

    public function testOpaqueOnlyAccountCannotUsePasswordOrCode(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        foreach ([['password' => self::PASSWORD], ['password' => ''], ['code' => '123456'], []] as $body) {
            $r = $this->call('DELETE', '/api/auth/me', $body, $auth);
            $this->assertSame(409, $r['status']);
            $this->assertSame('opaque_required', $r['body']['code']);
        }
        $this->assertTrue($this->exists('ada@example.com'));
    }

    public function testTicketOfAnotherPurposeIsRefused(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ticket = $this->reauth($user, 'change-email', $auth);
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth);
        $this->assertSame(403, $r['status']);
        $this->assertSame('reauth_required', $r['body']['code']);
        $this->assertTrue($this->exists('ada@example.com'));
    }

    public function testTicketIsSingleUseExpiresAndEndsWithTokenVersion(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ticket = $this->service(OpaqueReauthTickets::class)->issue($this->reload($user->getId()), 'delete-account');
        // replay: first use burns it on a refused deletion (club's last member)
        $club = TestHelper::createClub($this->em(), $this->reload($user->getId()));
        $other = $this->legacyUser('other@example.com');
        TestHelper::addMember($this->em(), $club, $other, \App\Enum\ClubRole::EDITOR);
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth);
        $this->assertSame(422, $r['status']);
        $this->assertSame('last_admin_of_club', $r['body']['code']);
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth);
        $this->assertSame('reauth_required', $r['body']['code']);

        // token version bump
        $fresh = $this->ticketFor($user, 'delete-account');
        $u = $this->reload($user->getId());
        $u->invalidateTokens();
        $this->em()->flush();
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $fresh], $this->bearer($user));
        $this->assertSame('reauth_required', $r['body']['code']);

        // expiry
        $fresh = $this->ticketFor($user, 'delete-account');
        static::mockTime(new \DateTimeImmutable('+6 minutes'));
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $fresh], $this->bearer($user));
        $this->assertSame('reauth_required', $r['body']['code']);
    }

    public function testTicketOfAnotherUserIsRefused(): void
    {
        $ada = $this->opaqueUser('ada@example.com');
        $bob = $this->opaqueUser('bob@example.com');
        $ticket = $this->reauth($ada, 'delete-account', $this->bearer($ada));
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $this->bearer($bob));
        $this->assertSame('reauth_required', $r['body']['code']);
        $this->assertTrue($this->exists('bob@example.com'));
        $this->assertTrue($this->exists('ada@example.com'));
    }

    public function testLegacyAccountKeepsPasswordAndAlsoAcceptsTickets(): void
    {
        $legacy = $this->legacyUser('legacy@example.com');
        $r = $this->call('DELETE', '/api/auth/me', ['password' => self::PASSWORD], $this->bearer($legacy));
        $this->assertSame(200, $r['status']);

        $upgraded = $this->upgradedUser('up@example.com');
        $auth = $this->bearer($upgraded);
        $this->assertSame('opaque_required', $this->call('DELETE', '/api/auth/me', ['password' => 'wrong'], $auth)['body']['code']);
        $ticket = $this->reauth($upgraded, 'delete-account', $auth);
        $this->assertSame(200, $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth)['status']);

        // The kept hash is no proof while OPAQUE is enabled, not even the right password.
        $upgraded2 = $this->upgradedUser('up2@example.com');
        $this->assertSame('opaque_required', $this->call('DELETE', '/api/auth/me', ['password' => self::PASSWORD], $this->bearer($upgraded2))['body']['code']);
    }

    public function testPasswordlessAccountStillUsesTheMailedCode(): void
    {
        $user = $this->ssoUser();
        $auth = $this->bearer($user);
        $r = $this->call('DELETE', '/api/auth/me', ['code' => '000000'], $auth);
        $this->assertSame('invalid_confirmation_code', $r['body']['code']);
        $r = $this->call('DELETE', '/api/auth/me', ['reauthTicket' => 'forged'], $auth);
        $this->assertSame('reauth_required', $r['body']['code']);
    }

    public function testGatedUsersCanDeleteViaReauthButNotOtherPurposes(): void
    {
        $unverified = $this->opaqueUser('unv@example.com', false);
        $auth = $this->bearer($unverified);
        $this->assertSame(403, $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => 'x'], $auth)['status']);
        $blocked = $this->call('POST', self::START, ['purpose' => 'change-email', 'startLoginRequest' => 'x'], $auth);
        $this->assertSame('email_verification_required', $blocked['body']['code']);
        $ticket = $this->reauth($unverified, 'delete-account', $auth);
        $this->assertIsString($ticket);
        $this->assertSame(200, $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth)['status']);

        LegalTestHelper::publish($this->em(), LegalDocumentType::PRIVACY);
        LegalTestHelper::publish($this->em(), LegalDocumentType::TERMS);
        $pending = $this->opaqueUser('pend@example.com');
        $auth = $this->bearer($pending, false);
        $blocked = $this->call('POST', self::START, ['purpose' => 'passkey-register', 'startLoginRequest' => 'x'], $auth);
        $this->assertSame('consent_required', $blocked['body']['code']);
        $ticket = $this->reauth($pending, 'delete-account', $auth);
        $this->assertIsString($ticket);
        $this->assertSame(200, $this->call('DELETE', '/api/auth/me', ['reauthTicket' => $ticket], $auth)['status']);
    }

    // --- passkey options ---

    public function testPasskeyOptionsWithTicket(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $this->assertSame('opaque_required', $this->call('POST', '/api/auth/webauthn/register/options', ['password' => self::PASSWORD], $auth)['body']['code']);
        $wrong = $this->reauth($user, 'change-email', $auth);
        $this->assertSame(403, $this->call('POST', '/api/auth/webauthn/register/options', ['reauthTicket' => $wrong], $auth)['status']);

        $ticket = $this->reauth($user, 'passkey-register', $auth);
        $r = $this->call('POST', '/api/auth/webauthn/register/options', ['reauthTicket' => $ticket], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertArrayHasKey('challengeToken', $r['body']);
        $this->assertSame(403, $this->call('POST', '/api/auth/webauthn/register/options', ['reauthTicket' => $ticket], $auth)['status']);
    }

    // --- change e-mail ---

    public function testChangeEmailWithTicket(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $r = $this->call('POST', '/api/auth/change-email', ['email' => 'new@example.com', 'password' => self::PASSWORD], $auth);
        $this->assertSame(409, $r['status']);
        $this->assertSame('opaque_required', $r['body']['code']);

        $wrong = $this->reauth($user, 'delete-account', $auth);
        $r = $this->call('POST', '/api/auth/change-email', ['email' => 'new@example.com', 'reauthTicket' => $wrong], $auth);
        $this->assertSame(403, $r['status']);

        $ticket = $this->reauth($user, 'change-email', $auth);
        $this->assertSame(204, $this->call('POST', '/api/auth/change-email', ['email' => 'new@example.com', 'reauthTicket' => $ticket], $auth)['status']);
        $this->assertSame(403, $this->call('POST', '/api/auth/change-email', ['email' => 'new@example.com', 'reauthTicket' => $ticket], $auth)['status']);
    }

    public function testChangeEmailLegacyPasswordUnchangedAndSsoStill409(): void
    {
        $legacy = $this->legacyUser();
        $this->assertSame(204, $this->call('POST', '/api/auth/change-email', ['email' => 'new@example.com', 'password' => self::PASSWORD], $this->bearer($legacy))['status']);
        $sso = $this->ssoUser();
        $r = $this->call('POST', '/api/auth/change-email', ['email' => 'x@example.com', 'password' => 'whatever'], $this->bearer($sso));
        $this->assertSame(409, $r['status']);
        $this->assertSame('no_password', $r['body']['code']);
    }

    // --- change password end to end ---

    public function testChangePasswordEndToEnd(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ticket = $this->reauth($user, 'change-password', $auth);
        $this->assertIsString($ticket);
        $reg = $this->opaque->startRegistration('a brand new password');
        $start = $this->call('POST', '/api/auth/opaque/register/start', ['reauthTicket' => $ticket, 'registrationRequest' => Base64Url::encode($reg['request'])], $auth);
        $this->assertSame(200, $start['status']);
        $record = $this->opaque->finishRegistration('a brand new password', $reg['blind'], Base64Url::decode($start['body']['registrationResponse']))['record'];
        $state = $start['body']['registrationState'];
        $finish = $this->call('POST', '/api/auth/opaque/register/finish', ['reauthTicket' => $ticket, 'registrationState' => $state, 'registrationRecord' => Base64Url::encode($record)], $auth);
        $this->assertSame(200, $finish['status']);
        // the ticket is burned and the old password no longer reauths
        $this->assertSame(403, $this->call('POST', '/api/auth/opaque/register/finish', ['reauthTicket' => $ticket, 'registrationState' => $state, 'registrationRecord' => Base64Url::encode($record)], $this->bearer($user))['status']);
    }

    public function testServiceAcceptsTicketOnlyOnceViaReauthenticationService(): void
    {
        $user = $this->opaqueUser();
        $service = $this->service(ReauthenticationService::class);
        $ticket = $this->ticketFor($user, 'passkey-register');
        $user = $this->reload($user->getId());
        $service->assertConfirmed($user, ReauthenticationService::PURPOSE_PASSKEY, null, null, $ticket);
        $this->expectExceptionMessage('Re-authentication is required');
        $service->assertConfirmed($user, ReauthenticationService::PURPOSE_PASSKEY, null, null, $ticket);
    }
}
