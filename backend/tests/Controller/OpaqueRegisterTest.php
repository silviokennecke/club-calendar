<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\EmailChange;
use App\Entity\User;
use App\Enum\LegalDocumentType;
use App\Opaque\Base64Url;
use App\Opaque\OpaqueReauthTickets;
use App\Opaque\OpaqueService;
use App\Opaque\OpaqueUpgradeTickets;
use App\Service\ClubInvitationService;
use App\Service\PasswordResetService;
use App\Service\RegistrationPolicy;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use App\Tests\Opaque\OpaqueTestClient;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** OPAQUE registration contexts: signup, password reset, password change and legacy upgrade. */
class OpaqueRegisterTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string PASSWORD = 'correct horse battery';
    private const string NEW_PASSWORD = 'another staple horse';

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

    private function legacyUser(string $email = 'ada@example.com', bool $verified = true): User
    {
        return TestHelper::createUser($this->em(), $this->service(UserPasswordHasherInterface::class), $email, self::PASSWORD, $verified);
    }

    private function opaqueUser(string $email = 'ada@example.com', bool $verified = true): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified($verified);
        $service = $this->service(OpaqueService::class);
        $reg = $this->opaque->startRegistration(self::PASSWORD);
        $service->storeRecord($user, $this->opaque->finishRegistration(self::PASSWORD, $reg['blind'], $service->registrationResponse($user, $reg['request']))['record']);
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    /** @return array{status: int, body: mixed, headers: array} */
    private function post(string $path, array $body, string $auth = ''): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', $path, $body, $auth);
    }

    private function bearer(User $user): string
    {
        return TestHelper::authHeader($this->reload($user->getId()), $this->service(\App\Service\TokenService::class));
    }

    /**
     * Start and client step of a registration.
     *
     * @return array{start: array, reg: array, response: ?string, record: ?string}
     */
    private function startRegistration(array $credential, string $password = self::PASSWORD, string $auth = ''): array
    {
        $reg = $this->opaque->startRegistration($password);
        $start = $this->post('/api/auth/opaque/register/start', $credential + ['registrationRequest' => Base64Url::encode($reg['request'])], $auth);
        $response = $record = null;
        if (200 === $start['status']) {
            $response = Base64Url::decode($start['body']['registrationResponse']);
            $record = $this->opaque->finishRegistration($password, $reg['blind'], $response)['record'];
        }

        return ['start' => $start, 'reg' => $reg, 'response' => $response, 'record' => $record];
    }

    private function finish(array $flow, array $credential, array $extra = [], string $auth = ''): array
    {
        // Outside signup the credential is a link/ticket and the start's state travels along.
        if (!isset($credential['registrationState']) && isset($flow['start']['body']['registrationState'])) {
            $credential['registrationState'] = $flow['start']['body']['registrationState'];
        }

        return $this->post('/api/auth/opaque/register/finish', $credential + ['registrationRecord' => Base64Url::encode($flow['record'])] + $extra, $auth);
    }

    /** @return array{status: int, body: mixed} */
    private function opaqueLogin(string $email, string $password = self::PASSWORD): array
    {
        $ke1 = $this->opaque->startLogin($password);
        $start = $this->post('/api/auth/opaque/login/start', ['email' => $email, 'startLoginRequest' => Base64Url::encode($ke1['ke1'])]);
        $result = $this->opaque->finishLogin($password, $ke1, Base64Url::decode($start['body']['loginResponse']) ?? '');
        if (null === $result) {
            return ['status' => 0, 'body' => null];
        }

        return $this->post('/api/auth/opaque/login/finish', ['loginState' => $start['body']['loginState'], 'finishLoginRequest' => Base64Url::encode($result['ke3'])]);
    }

    private function signup(string $email = 'new@example.com', array $extra = []): array
    {
        $flow = $this->startRegistration(['email' => $email]);
        $this->assertSame(200, $flow['start']['status'], json_encode($flow['start']['body']));
        $finish = $this->finish($flow, ['registrationState' => $flow['start']['body']['registrationState']], $extra + ['name' => 'New User']);

        return ['flow' => $flow, 'finish' => $finish];
    }

    private function codeFromMail(string $to): string
    {
        $mails = array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email && $m->getTo()[0]->getAddress() === $to));
        $this->assertNotEmpty($mails, 'no mail was sent');
        $this->assertSame(1, preg_match('/>\s*(\d{6})\s*</', (string) end($mails)->getHtmlBody(), $m));

        return $m[1];
    }

    // --- signup ---

    public function testSignupFullFlowThenVerifyEmailThenOpaqueLogin(): void
    {
        $privacy = LegalTestHelper::publish($this->em(), LegalDocumentType::PRIVACY);
        $terms = LegalTestHelper::publish($this->em(), LegalDocumentType::TERMS);

        $r = $this->signup('New@Example.com', ['language' => 'de', 'acceptedDocuments' => [$privacy->getId(), $terms->getId()]]);
        $this->assertSame(201, $r['finish']['status'], json_encode($r['finish']['body']));
        $body = $r['finish']['body'];
        // The mail logger is reset after every request: read the code now.
        $code = $this->codeFromMail('new@example.com');
        $this->assertTrue($body['verificationRequired']);
        $this->assertSame('new@example.com', $body['email']);
        $this->assertTrue($body['emailVerificationRequired']);

        $user = $this->em()->getRepository(User::class)->findOneBy(['email' => 'new@example.com']);
        $this->assertNull($user->getPassword());
        $this->assertNotNull($user->getOpaqueRecord());
        $this->assertSame('de', $user->getLanguage());
        $this->assertFalse($user->isEmailVerified());
        $this->assertTrue($user->hasPasswordCredential());

        // The restricted session reaches only the confirmation.
        $this->assertSame(403, TestHelper::jsonRequest($this->client, 'GET', '/api/clubs', [], 'Bearer '.$body['access_token'])['status']);
        $verified = $this->post('/api/auth/verify-email', ['code' => $code], 'Bearer '.$body['access_token']);
        $this->assertSame(200, $verified['status'], json_encode($verified['body']));

        $login = $this->opaqueLogin('new@example.com');
        $this->assertSame(200, $login['status']);
        $this->assertFalse($login['body']['emailVerificationRequired']);
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/clubs', [], 'Bearer '.$login['body']['access_token'])['status']);
        $this->assertSame(0, $this->opaqueLogin('new@example.com', 'wrong password')['status']);
    }

    public function testSignupCredentialIdIsTheServerMintedStateId(): void
    {
        $flow = $this->startRegistration(['email' => 'new@example.com']);
        $state = $flow['start']['body']['registrationState'];
        $claims = json_decode((string) base64_decode(strtr(explode('.', $state)[0], '-_', '+/')), true);
        $this->assertTrue(\Symfony\Component\Uid\Uuid::isValid($claims['uid']));
        $this->assertSame(
            Base64Url::encode($this->service(OpaqueService::class)->registrationResponseFor($claims['uid'], $flow['reg']['request'])),
            $flow['start']['body']['registrationResponse'],
        );

        // Extra client fields are not read: the email and id come from the state.
        $r = $this->finish($flow, ['registrationState' => $state], ['name' => 'N', 'email' => 'other@example.com', 'userId' => 'x', 'id' => 'y']);
        $this->assertSame(201, $r['status']);
        $em = $this->em();
        $this->assertNull($em->getRepository(User::class)->findOneBy(['email' => 'other@example.com']));
        $user = $em->getRepository(User::class)->findOneBy(['email' => 'new@example.com']);
        $this->assertSame($claims['uid'], $user->getId());
        $this->assertSame(200, $this->opaqueLogin('new@example.com')['status']);
    }

    public function testSignupStartAnswersTheSameForTakenAndFreeAddressesAndFinishReportsEmailTaken(): void
    {
        $this->legacyUser('taken@example.com');
        $taken = $this->startRegistration(['email' => 'taken@example.com']);
        $free = $this->startRegistration(['email' => 'freed@example.com']);
        $this->assertSame(200, $taken['start']['status']);
        $this->assertSame(array_keys($free['start']['body']), array_keys($taken['start']['body']));
        $this->assertSame(strlen($free['start']['body']['registrationResponse']), strlen($taken['start']['body']['registrationResponse']));
        $this->assertSame(strlen($free['start']['body']['registrationState']), strlen($taken['start']['body']['registrationState']));

        $r = $this->finish($taken, ['registrationState' => $taken['start']['body']['registrationState']], ['name' => 'T']);
        $this->assertSame(400, $r['status']);
        $this->assertSame('email_taken', $r['body']['code']);
        $this->assertSame('email', $r['body']['field']);
        $this->assertNull($this->em()->getRepository(User::class)->findOneBy(['email' => 'taken@example.com'])->getOpaqueRecord());
    }

    public function testSignupRequiresCurrentConsent(): void
    {
        $privacy = LegalTestHelper::publish($this->em(), LegalDocumentType::PRIVACY);
        $flow = $this->startRegistration(['email' => 'new@example.com']);
        $state = ['registrationState' => $flow['start']['body']['registrationState']];

        $r = $this->finish($flow, $state, ['name' => 'N', 'acceptedDocuments' => []]);
        $this->assertSame('consent_required', $r['body']['code']);
        $this->assertNull($this->em()->getRepository(User::class)->findOneBy(['email' => 'new@example.com']));

        // The failed attempt did not burn the state.
        $ok = $this->finish($flow, $state, ['name' => 'N', 'acceptedDocuments' => [$privacy->getId()]]);
        $this->assertSame(201, $ok['status'], json_encode($ok['body']));
    }

    public function testSignupHonoursRestrictedRegistration(): void
    {
        $this->client->disableReboot();
        $container = static::getContainer();
        $container->set(RegistrationPolicy::class, new RegistrationPolicy($container->get(ClubInvitationService::class), true));

        $r = $this->signup('stranger@example.com');
        $this->assertSame(403, $r['finish']['status']);
        $this->assertSame('registration_restricted', $r['finish']['body']['code']);
        $this->assertSame('email', $r['finish']['body']['field']);
        $this->assertNull($this->em()->getRepository(User::class)->findOneBy(['email' => 'stranger@example.com']));
    }

    public function testSignupStateIsSingleUseTamperProofAndExpires(): void
    {
        $r = $this->signup();
        $this->assertSame(201, $r['finish']['status']);
        $state = ['registrationState' => $r['flow']['start']['body']['registrationState']];
        // Replay after success: the id is taken now; a consumed state is refused as such.
        $replay = $this->finish($r['flow'], $state, ['name' => 'N']);
        $this->assertContains($replay['body']['code'], ['email_taken', 'opaque_state_invalid']);
        $this->assertSame(1, $this->em()->getRepository(User::class)->count([]));

        $flow = $this->startRegistration(['email' => 'b@example.com']);
        $good = $flow['start']['body']['registrationState'];
        $tampered = $good;
        $tampered[5] = 'A' === $tampered[5] ? 'B' : 'A';
        foreach ([$tampered, 'garbage', substr($good, 0, -2)] as $bad) {
            $x = $this->finish($flow, ['registrationState' => $bad], ['name' => 'N']);
            $this->assertSame(409, $x['status']);
            $this->assertSame('opaque_state_invalid', $x['body']['code']);
        }

        static::mockTime('+16 minutes');
        $expired = $this->finish($flow, ['registrationState' => $good], ['name' => 'N']);
        $this->assertSame('opaque_state_invalid', $expired['body']['code']);
    }

    public function testSignupStateIsNotAcceptedForOtherPurposes(): void
    {
        $signed = $this->service(\App\Security\SignedTokenService::class);
        $foreign = $signed->issue('opaque-reauth', ['uid' => 'x', 'email' => 'new@example.com', 'jti' => 'j'], 600);
        $flow = $this->startRegistration(['email' => 'new@example.com']);
        $r = $this->finish($flow, ['registrationState' => $foreign], ['name' => 'N']);
        $this->assertSame('opaque_state_invalid', $r['body']['code']);
    }

    public function testSignupRateLimitsPerAddressAndIp(): void
    {
        for ($i = 0; $i < 3; ++$i) {
            $this->assertSame(200, $this->startRegistration(['email' => 'same@example.com'])['start']['status']);
        }
        $limited = $this->startRegistration(['email' => 'same@example.com'])['start'];
        $this->assertSame(429, $limited['status']);
        $this->assertSame('rate_limited', $limited['body']['code']);
        $this->assertGreaterThanOrEqual(1, (int) ($limited['headers']['retry-after'][0] ?? 0));
        $this->assertSame(200, $this->startRegistration(['email' => 'other@example.com'])['start']['status']);
    }

    public function testSignupNeedsAName(): void
    {
        $flow = $this->startRegistration(['email' => 'new@example.com']);
        $r = $this->finish($flow, ['registrationState' => $flow['start']['body']['registrationState']], ['name' => '  ']);
        $this->assertSame(422, $r['status']);
        $this->assertSame('name', $r['body']['field']);
    }

    // --- password reset ---

    public function testResetReplacesTheLegacyPasswordAndEndsSessions(): void
    {
        $user = $this->legacyUser('ada@example.com', false);
        $oldAccess = $this->post('/api/auth/login', ['email' => 'ada@example.com', 'password' => self::PASSWORD])['body']['access_token'];
        $token = $this->service(PasswordResetService::class)->createToken($user);

        $flow = $this->startRegistration(['resetToken' => $token], self::NEW_PASSWORD);
        $this->assertSame(200, $flow['start']['status']);
        $this->assertArrayHasKey('registrationState', $flow['start']['body']);
        $this->assertSame(
            Base64Url::encode($this->service(OpaqueService::class)->registrationResponse($user, $flow['reg']['request'])),
            $flow['start']['body']['registrationResponse'],
        );
        $r = $this->finish($flow, ['resetToken' => $token]);
        $this->assertSame(204, $r['status'], json_encode($r['body']));
        $notices = array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email && 'ada@example.com' === $m->getTo()[0]->getAddress());
        $this->assertNotEmpty($notices);

        $fresh = $this->reload($user->getId());
        $this->assertNull($fresh->getPassword());
        $this->assertNotNull($fresh->getOpaqueRecord());
        $this->assertTrue($fresh->isEmailVerified());
        $this->assertSame(409, $this->post('/api/auth/login', ['email' => 'ada@example.com', 'password' => self::PASSWORD])['status']);
        $this->assertSame(401, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$oldAccess)['status']);
        $this->assertSame(200, $this->opaqueLogin('ada@example.com', self::NEW_PASSWORD)['status']);
        $this->assertSame(0, $this->opaqueLogin('ada@example.com', self::PASSWORD)['status']);
    }

    public function testResetOfAnOpaqueAccountReplacesTheRecordAndDiscardsEmailChange(): void
    {
        $user = $this->opaqueUser();
        $this->em()->persist(new EmailChange($user, 'new@example.com', 'hash', new \DateTimeImmutable()));
        $this->em()->flush();
        $token = $this->service(PasswordResetService::class)->createToken($user);
        $flow = $this->startRegistration(['resetToken' => $token], self::NEW_PASSWORD);
        $this->assertSame(204, $this->finish($flow, ['resetToken' => $token])['status']);

        $this->assertSame(200, $this->opaqueLogin('ada@example.com', self::NEW_PASSWORD)['status']);
        $this->assertSame(0, $this->opaqueLogin('ada@example.com')['status']);
        $this->assertSame(0, $this->em()->getRepository(EmailChange::class)->count(['user' => $this->reload($user->getId())]));
    }

    public function testResetTokenIsSingleUseAndBoundToItsUser(): void
    {
        $ada = $this->legacyUser('ada@example.com');
        $bob = $this->legacyUser('bob@example.com');
        $service = $this->service(PasswordResetService::class);
        $adaToken = $service->createToken($ada);
        $bobToken = $service->createToken($bob);

        // The response is evaluated under the link's user, whatever else the body says.
        $flow = $this->startRegistration(['resetToken' => $adaToken], self::NEW_PASSWORD);
        $opaque = $this->service(OpaqueService::class);
        $this->assertSame(Base64Url::encode($opaque->registrationResponse($this->reload($ada->getId()), $flow['reg']['request'])), $flow['start']['body']['registrationResponse']);
        $this->assertNotSame(Base64Url::encode($opaque->registrationResponse($this->reload($bob->getId()), $flow['reg']['request'])), $flow['start']['body']['registrationResponse']);

        $this->assertSame(204, $this->finish($flow, ['resetToken' => $adaToken])['status']);
        $this->assertNull($this->reload($bob->getId())->getOpaqueRecord());
        $adaFlow = $flow;
        $flow = $this->startRegistration(['resetToken' => $bobToken], self::NEW_PASSWORD);

        foreach ([$adaToken, 'unknown-token'] as $dead) {
            $again = $this->finish($adaFlow, ['resetToken' => $dead]);
            $this->assertSame(400, $again['status']);
            $this->assertSame('invalid_reset_token', $again['body']['code']);
            $start = $this->startRegistration(['resetToken' => $dead])['start'];
            $this->assertSame('invalid_reset_token', $start['body']['code']);
        }
        // Bob's link is untouched.
        $this->assertSame(204, $this->finish($flow, ['resetToken' => $bobToken])['status']);
    }

    public function testResetWithMalformedRecordKeepsTheLink(): void
    {
        $user = $this->legacyUser();
        $token = $this->service(PasswordResetService::class)->createToken($user);
        $flow = $this->startRegistration(['resetToken' => $token]);
        $bad = $this->post('/api/auth/opaque/register/finish', ['resetToken' => $token, 'registrationRecord' => Base64Url::encode(str_repeat("\xff", 192))]);
        $this->assertSame(400, $bad['status']);
        $this->assertSame('invalid_opaque_message', $bad['body']['code']);
        $this->assertSame(204, $this->finish($flow, ['resetToken' => $token])['status']);
    }

    public function testResetStartConsumesTheLoginLimits(): void
    {
        $user = $this->legacyUser();
        $token = $this->service(PasswordResetService::class)->createToken($user);
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(200, $this->startRegistration(['resetToken' => $token])['start']['status']);
        }
        $limited = $this->startRegistration(['resetToken' => $token])['start'];
        $this->assertSame(429, $limited['status']);
        $this->assertSame('rate_limited', $limited['body']['code']);
    }

    // --- password change ---

    public function testChangeFlowRotatesSessionsAndRemovesLegacyHash(): void
    {
        $user = $this->opaqueUser();
        $user->setPassword('$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
        $this->em()->flush();
        $this->em()->persist(new EmailChange($user, 'new@example.com', 'hash', new \DateTimeImmutable()));
        $this->em()->flush();
        $oldAuth = $this->bearer($user);
        $ticket = $this->service(OpaqueReauthTickets::class)->issue($this->reload($user->getId()), OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);

        $flow = $this->startRegistration(['reauthTicket' => $ticket], self::NEW_PASSWORD, $oldAuth);
        $this->assertSame(200, $flow['start']['status'], json_encode($flow['start']['body']));
        $this->assertSame(
            Base64Url::encode($this->service(OpaqueService::class)->registrationResponse($this->reload($user->getId()), $flow['reg']['request'])),
            $flow['start']['body']['registrationResponse'],
        );
        $r = $this->finish($flow, ['reauthTicket' => $ticket], [], $oldAuth);
        $this->assertSame(200, $r['status'], json_encode($r['body']));
        $this->assertNotEmpty(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email && 'ada@example.com' === $m->getTo()[0]->getAddress()));
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);

        $fresh = $this->reload($user->getId());
        $this->assertNull($fresh->getPassword());
        $this->assertSame(0, $this->em()->getRepository(EmailChange::class)->count(['user' => $fresh]));
        $this->assertSame(401, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $oldAuth)['status']);
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token'])['status']);
        $this->assertSame(200, $this->opaqueLogin('ada@example.com', self::NEW_PASSWORD)['status']);
        $this->assertSame(0, $this->opaqueLogin('ada@example.com')['status']);
    }

    public function testChangeNeedsLoginAndAValidTicket(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $tickets = $this->service(OpaqueReauthTickets::class);
        $good = $tickets->issue($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);
        $reg = $this->opaque->startRegistration(self::NEW_PASSWORD);
        $request = Base64Url::encode($reg['request']);

        // No JWT
        $this->assertSame(401, $this->post('/api/auth/opaque/register/start', ['reauthTicket' => $good, 'registrationRequest' => $request])['status']);
        $record = $this->opaque->finishRegistration(self::NEW_PASSWORD, $reg['blind'], $this->service(OpaqueService::class)->registrationResponse($user, $reg['request']))['record'];
        $this->assertSame(401, $this->post('/api/auth/opaque/register/finish', ['reauthTicket' => $good, 'registrationRecord' => Base64Url::encode($record)])['status']);

        $other = $this->opaqueUser('bob@example.com');
        $wrong = [
            'other purpose' => $tickets->issue($user, OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT),
            'other user' => $tickets->issue($other, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD),
            'upgrade ticket' => $this->service(OpaqueUpgradeTickets::class)->issue($user),
            'garbage' => 'garbage',
        ];
        foreach ($wrong as $label => $ticket) {
            $r = $this->post('/api/auth/opaque/register/start', ['reauthTicket' => $ticket, 'registrationRequest' => $request], $auth);
            $this->assertSame(403, $r['status'], $label);
            $this->assertSame('reauth_required', $r['body']['code'], $label);
        }
        $this->assertNull($this->reload($user->getId())->getPassword());
    }

    public function testChangeTicketIsSingleUseAndDiesWithTheSession(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $tickets = $this->service(OpaqueReauthTickets::class);
        $ticket = $tickets->issue($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);
        $flow = $this->startRegistration(['reauthTicket' => $ticket], self::NEW_PASSWORD, $auth);
        $this->assertSame(200, $this->finish($flow, ['reauthTicket' => $ticket], [], $auth)['status']);

        $auth2 = $this->bearer($user);
        $replay = $this->finish($flow, ['reauthTicket' => $ticket], [], $auth2);
        $this->assertSame(403, $replay['status']);
        $this->assertSame('reauth_required', $replay['body']['code']);

        // A ticket from before a session bump (tokenVersion) is void.
        $old = $tickets->issue($this->reload($user->getId()), OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);
        $u = $this->reload($user->getId());
        $u->invalidateTokens();
        $this->em()->flush();
        $r = $this->finish($flow, ['reauthTicket' => $old], [], $this->bearer($user));
        $this->assertSame('reauth_required', $r['body']['code']);
    }

    public function testMalformedRecordDoesNotBurnTheChangeTicket(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ticket = $this->service(OpaqueReauthTickets::class)->issue($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);
        $bad = $this->post('/api/auth/opaque/register/finish', ['reauthTicket' => $ticket, 'registrationRecord' => Base64Url::encode(random_bytes(100))], $auth);
        $this->assertSame('invalid_opaque_message', $bad['body']['code']);
        $flow = $this->startRegistration(['reauthTicket' => $ticket], self::NEW_PASSWORD, $auth);
        $this->assertSame(200, $this->finish($flow, ['reauthTicket' => $ticket], [], $auth)['status']);
    }

    public function testChangeIsGatedForUnverifiedUsers(): void
    {
        $user = $this->opaqueUser('new@example.com', false);
        $reg = $this->opaque->startRegistration(self::NEW_PASSWORD);
        $ticket = $this->service(OpaqueReauthTickets::class)->issue($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);
        $r = $this->post('/api/auth/opaque/register/start', ['reauthTicket' => $ticket, 'registrationRequest' => Base64Url::encode($reg['request'])], $this->bearer($user));
        $this->assertSame(403, $r['status']);
        $this->assertSame('email_verification_required', $r['body']['code']);
    }

    public function testChangeStartConsumesTheLoginLimits(): void
    {
        $user = $this->opaqueUser();
        $auth = $this->bearer($user);
        $ticket = $this->service(OpaqueReauthTickets::class)->issue($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD);
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(200, $this->startRegistration(['reauthTicket' => $ticket], self::PASSWORD, $auth)['start']['status']);
        }
        $limited = $this->startRegistration(['reauthTicket' => $ticket], self::PASSWORD, $auth)['start'];
        $this->assertSame(429, $limited['status']);
        $this->assertSame('rate_limited', $limited['body']['code']);
    }

    // --- legacy upgrade ---

    public function testUpgradeStoresTheRecordAndKeepsTheBcryptHash(): void
    {
        $user = $this->legacyUser();
        $login = $this->post('/api/auth/login', ['email' => 'ada@example.com', 'password' => self::PASSWORD])['body'];
        $auth = 'Bearer '.$login['access_token'];
        $hash = $this->reload($user->getId())->getPassword();
        $ticket = $this->service(OpaqueUpgradeTickets::class)->issue($this->reload($user->getId()));

        $flow = $this->startRegistration(['upgradeTicket' => $ticket], self::PASSWORD, $auth);
        $this->assertSame(200, $flow['start']['status'], json_encode($flow['start']['body']));
        $r = $this->finish($flow, ['upgradeTicket' => $ticket], [], $auth);
        $this->assertSame(204, $r['status'], json_encode($r['body']));

        $fresh = $this->reload($user->getId());
        $this->assertNotNull($fresh->getOpaqueRecord());
        $this->assertSame($hash, $fresh->getPassword());
        // Running sessions stay valid, both sign-in paths work.
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], $auth)['status']);
        $this->assertSame(200, $this->opaqueLogin('ada@example.com')['status']);
        // The kept hash is no proof while OPAQUE is enabled.
        $this->assertSame('opaque_required', $this->post('/api/auth/login', ['email' => 'ada@example.com', 'password' => self::PASSWORD])['body']['code']);
    }

    public function testUpgradeNeedsLoginTicketAndNoExistingRecord(): void
    {
        $user = $this->legacyUser();
        $auth = $this->bearer($user);
        $tickets = $this->service(OpaqueUpgradeTickets::class);
        $ticket = $tickets->issue($user);
        $reg = $this->opaque->startRegistration(self::PASSWORD);
        $request = Base64Url::encode($reg['request']);

        $this->assertSame(401, $this->post('/api/auth/opaque/register/start', ['upgradeTicket' => $ticket, 'registrationRequest' => $request])['status']);
        foreach (['garbage', $this->service(OpaqueReauthTickets::class)->issue($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD), $tickets->issue($this->legacyUser('bob@example.com'))] as $bad) {
            $r = $this->post('/api/auth/opaque/register/start', ['upgradeTicket' => $bad, 'registrationRequest' => $request], $auth);
            $this->assertSame('reauth_required', $r['body']['code']);
        }

        $flow = $this->startRegistration(['upgradeTicket' => $ticket], self::PASSWORD, $auth);
        $this->assertSame(204, $this->finish($flow, ['upgradeTicket' => $ticket], [], $auth)['status']);
        $replay = $this->finish($flow, ['upgradeTicket' => $ticket], [], $auth);
        $this->assertSame(409, $replay['status']);
        $this->assertSame('opaque_already_registered', $replay['body']['code']);

        $again = $this->post('/api/auth/opaque/register/start', ['upgradeTicket' => $tickets->issue($this->reload($user->getId())), 'registrationRequest' => $request], $auth);
        $this->assertSame('opaque_already_registered', $again['body']['code']);
    }

    // --- general ---

    public function testExactlyOneCredentialFieldSelectsTheContext(): void
    {
        $request = Base64Url::encode($this->opaque->startRegistration(self::PASSWORD)['request']);
        $record = Base64Url::encode(str_repeat("\1", 192));
        $cases = [
            ['start', ['registrationRequest' => $request]],
            ['start', ['email' => 'a@example.com', 'resetToken' => 't', 'registrationRequest' => $request]],
            ['start', ['email' => '', 'resetToken' => '', 'registrationRequest' => $request]],
            ['finish', ['registrationRecord' => $record]],
            ['finish', ['upgradeTicket' => 's', 'resetToken' => 't', 'registrationRecord' => $record]],
        ];
        foreach ($cases as [$path, $body]) {
            $r = $this->post('/api/auth/opaque/register/'.$path, $body);
            $this->assertSame(400, $r['status'], json_encode($body));
            $this->assertSame('invalid_request', $r['body']['code'], json_encode($body));
        }
    }

    public function testDisabledFlagAnswers503(): void
    {
        $this->setEnabled('false');
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        foreach (['start' => ['email' => 'a@example.com', 'registrationRequest' => 'x'], 'finish' => ['registrationState' => 'x', 'registrationRecord' => 'x']] as $path => $body) {
            $r = $this->post('/api/auth/opaque/register/'.$path, $body);
            $this->assertSame(503, $r['status']);
            $this->assertSame('opaque_unavailable', $r['body']['code']);
        }
    }

    public function testMalformedInput(): void
    {
        $good = Base64Url::encode($this->opaque->startRegistration(self::PASSWORD)['request']);
        $startCases = [
            [['email' => 'a@example.com', 'registrationRequest' => '!!!'], 400, 'invalid_opaque_message'],
            [['email' => 'a@example.com', 'registrationRequest' => $good.'='], 400, 'invalid_opaque_message'],
            [['email' => 'a@example.com', 'registrationRequest' => Base64Url::encode(random_bytes(31))], 400, 'invalid_opaque_message'],
            [['email' => 'a@example.com', 'registrationRequest' => Base64Url::encode(str_repeat("\xff", 32))], 400, 'invalid_opaque_message'],
            [['email' => 'a@example.com', 'registrationRequest' => Base64Url::encode(str_repeat("\0", 32))], 400, 'invalid_opaque_message'],
            [['email' => 'a@example.com', 'registrationRequest' => 5], 400, 'invalid_request'],
            [['email' => 'not-an-email', 'registrationRequest' => $good], 422, 'validation_failed'],
            [['email' => 'a@example.com'], 422, 'validation_failed'],
        ];
        foreach ($startCases as $i => [$body, $status, $code]) {
            if (isset($body['email']) && 'not-an-email' !== $body['email']) {
                $body['email'] = 'case'.$i.'@example.com';
            }
            $r = $this->post('/api/auth/opaque/register/start', $body);
            $this->assertSame($status, $r['status'], json_encode($body));
            $this->assertSame($code, $r['body']['code'], json_encode($body));
        }

        $user = $this->legacyUser();
        $token = $this->service(PasswordResetService::class)->createToken($user);
        $record = random_bytes(192);
        $finishCases = [
            [['registrationRecord' => '***'], 400, 'invalid_opaque_message'],
            [['registrationRecord' => Base64Url::encode(random_bytes(191))], 400, 'invalid_opaque_message'],
            [['registrationRecord' => Base64Url::encode(str_repeat("\xff", 32).substr($record, 32))], 400, 'invalid_opaque_message'],
            [['registrationRecord' => ''], 422, 'validation_failed'],
        ];
        foreach ($finishCases as [$extra, $status, $code]) {
            $r = $this->post('/api/auth/opaque/register/finish', ['resetToken' => $token] + $extra);
            $this->assertSame($status, $r['status'], json_encode($extra));
            $this->assertSame($code, $r['body']['code'], json_encode($extra));
        }
        $this->client->request('POST', '/api/auth/opaque/register/finish', [], [], ['CONTENT_TYPE' => 'application/json'], 'not json');
        $this->assertSame(400, $this->client->getResponse()->getStatusCode());
    }
}
