<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\EmailChange;
use App\Entity\OAuthAccount;
use App\Entity\User;
use App\Service\PasswordResetService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Profile changes: name, password, e-mail address (confirmed by link), last calendar per membership.
 */
class AccountTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;
    private static string $frontendUrl;
    private static string $backendUrl;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
        self::$frontendUrl = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        self::$backendUrl = rtrim((string) $_ENV['BACKEND_URL'], '/');
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

    // --- helpers ---

    private function lastMailHtml(): string
    {
        $mail = $this->getMailerMessage();
        $this->assertInstanceOf(Email::class, $mail);

        return (string) $mail->getHtmlBody();
    }

    private function auth(User $user): string
    {
        return 'Bearer '.self::$tokens->createAccessToken($user);
    }

    private function user(string $id): User
    {
        self::$em->clear();

        return self::$em->getRepository(User::class)->find($id);
    }

    private function me(string $auth): array
    {
        return TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth);
    }

    private function ssoOnlyUser(string $email = 'sso@example.com'): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email);
        $user->setPassword(null);
        $account = new OAuthAccount();
        $account->setUser($user)->setProvider('google')->setProviderId('g-1')->setEmail('provider-address@gmail.example');
        self::$em->persist($account);
        self::$em->flush();

        return $user;
    }

    /** @return array{0: string, 1: string} Authorization header, step-up token (password) */
    private function su(User $user, string $password = 'password123'): array
    {
        $auth = TestHelper::sessionHeader($user, self::$tokens);

        return [$auth, TestHelper::stepUp(self::$client, $auth, null, $password)];
    }

    /** @return array{0: string, 1: string} step-up of an account without password (mailed code) */
    private function ssoSu(User $user): array
    {
        $auth = TestHelper::sessionHeader($user, self::$tokens);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/step-up/code', [], $auth);
        $this->assertSame(1, preg_match('/letter-spacing:\d+px[^>]*>(\d{3})-(\d{3})</', $this->lastMailHtml(), $m));

        return [$auth, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/step-up', ['confirmationCode' => $m[1].$m[2]], $auth)['body']['stepUpToken']];
    }

    private function changeEmail(User $user, string $email, bool $stepUp = true, array $server = []): array
    {
        $auth = TestHelper::sessionHeader($user, self::$tokens);
        $headers = [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_AUTHORIZATION' => $auth,
        ];
        if ($stepUp) {
            $headers['HTTP_X_STEP_UP_TOKEN'] = TestHelper::stepUp(self::$client, $auth);
        }
        self::$client->request('POST', '/api/auth/change-email', [], [], $headers + $server, (string) json_encode(['email' => $email]));
        $response = self::$client->getResponse();

        return [
            'status' => $response->getStatusCode(),
            'content' => (string) $response->getContent(),
            'body' => json_decode((string) $response->getContent(), true),
        ];
    }

    private function confirmTokenFromMail(): string
    {
        $html = $this->lastMailHtml();
        $this->assertSame(1, preg_match('#href="'.preg_quote(self::$backendUrl, '#').'/api/auth/verify-new-email\?token=([0-9a-f]{64})"#', $html, $m), $html);

        return $m[1];
    }

    /** @return array<string, string> query of the redirect to the frontend */
    private function openConfirmation(string $token): array
    {
        self::$client->request('GET', '/api/auth/verify-new-email?token='.$token);
        $response = self::$client->getResponse();
        $this->assertSame(302, $response->getStatusCode());
        $location = (string) $response->headers->get('Location');
        $this->assertStringStartsWith(self::$frontendUrl.'/auth/verify-email?', $location);
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $query);

        return $query;
    }

    private function login(string $email, string $password = 'password123'): int
    {
        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => $email, 'password' => $password])['status'];
    }

    // --- GET /me ---

    public function testMeShowsPasswordStateAndLinkedProvidersWithoutProviderDetails(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $me = $this->me($this->auth($user));
        $this->assertTrue($me['body']['hasPassword']);
        $this->assertSame([], $me['body']['oauthAccounts']);
        $this->assertNull($me['body']['pendingEmail']);

        $sso = $this->ssoOnlyUser();
        $me = $this->me($this->auth($sso));
        $this->assertFalse($me['body']['hasPassword']);
        $this->assertSame([['provider' => 'google']], $me['body']['oauthAccounts']);
        $this->assertStringNotContainsString('g-1', $me['content']);
        $this->assertStringNotContainsString('provider-address', $me['content']);
    }

    // --- name ---

    public function testNameCanBeChangedAndIsTrimmed(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['name' => '  Alex Beispiel  '], $this->auth($user));
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('Alex Beispiel', $r['body']['name']);
        $this->assertSame('Alex Beispiel', $this->user($user->getId())->getName());
    }

    public function testInvalidNamesAreRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        foreach (['', '   ', str_repeat('a', 256), 42, null] as $name) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['name' => $name], $this->auth($user));
            $this->assertSame(422, $r['status'], json_encode($name));
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame('name', $r['body']['field']);
        }
        $this->assertSame('Test User', $this->user($user->getId())->getName());
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['name' => str_repeat('ä', 255)], $this->auth($user));
        $this->assertSame(200, $r['status']);
    }

    /**
     * Wrong JSON types in the profile fields end in 400 validation_failed with the field, never in a 500
     * (the values were assigned to typed DTO properties / entity setters as they came).
     */
    public function testWronglyTypedProfileFieldsAreRejectedWith400(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $before = $this->me($auth)['body'];
        $object = ['a' => 1];
        $cases = [
            'dateFormat' => [5, 1.5, true, false, null, [], ['dd.MM.yyyy'], $object],
            'firstDayOfWeek' => ['1', '', 1.5, true, false, null, [], [1], $object],
            'language' => [5, 1.5, true, null, [], ['de'], $object],
            'lastClubId' => [5, 1.5, true, false, [], ['x'], $object],
            'lastCalendarId' => [5, 1.5, true, false, [], ['x'], $object],
        ];
        foreach ($cases as $field => $values) {
            foreach ($values as $value) {
                $label = $field.'='.json_encode($value);
                $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', [$field => $value], $auth);
                $this->assertSame(400, $r['status'], $label.' '.$r['content']);
                $this->assertSame('validation_failed', $r['body']['code'] ?? null, $label);
                $this->assertSame($field, $r['body']['field'] ?? null, $label);
            }
        }
        // Also next to valid fields: nothing is stored when one field is wrong.
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['language' => 'de', 'firstDayOfWeek' => '0'], $auth);
        $this->assertSame(400, $r['status']);
        $this->assertSame('firstDayOfWeek', $r['body']['field']);

        $this->assertSame($before, $this->me($auth)['body']);
    }

    public function testOverlongLastIdsAreRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = $this->auth($user);
        foreach (['lastClubId', 'lastCalendarId'] as $field) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', [$field => str_repeat('a', 37)], $auth);
            $this->assertSame(422, $r['status'], $field.' '.$r['content']);
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame($field, $r['body']['field']);
        }
    }

    public function testCorrectlyTypedProfileFieldsAreStillAccepted(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = $this->auth($user);
        $club = TestHelper::createClub(self::$em, $user, 'Mine');
        $calendar = TestHelper::createCalendar(self::$em, $club, 'Mine');

        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', [
            'dateFormat' => 'yyyy-MM-dd', 'firstDayOfWeek' => 0, 'language' => 'de',
            'lastClubId' => $club->getId(), 'lastCalendarId' => $calendar->getId(),
        ], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame('yyyy-MM-dd', $r['body']['dateFormat']);
        $this->assertSame(0, $r['body']['firstDayOfWeek']);
        $this->assertSame('de', $r['body']['language']);
        $this->assertSame($club->getId(), $r['body']['lastClubId']);
        $this->assertSame($calendar->getId(), $r['body']['lastCalendarId']);

        // null clears the last club / calendar
        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['lastClubId' => null, 'lastCalendarId' => null], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertNull($r['body']['lastClubId']);
        $this->assertNull($r['body']['lastCalendarId']);

        // Out-of-range values stay 422 (constraint violations, unchanged)
        foreach ([['firstDayOfWeek' => 7], ['language' => 'xx'], ['dateFormat' => '']] as $body) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', $body, $auth);
            $this->assertSame(422, $r['status'], json_encode($body));
            $this->assertSame((string) array_key_first($body), $r['body']['field']);
        }
    }

    // --- change password ---

    public function testChangePasswordReturnsNewTokensAndEndsOtherSessions(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $oldAccess = TestHelper::sessionHeader($user, self::$tokens);
        $oldRefresh = self::$tokens->createRefreshToken($user);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', [
            'newPassword' => 'new-password-1',
        ], $oldAccess, TestHelper::stepUp(self::$client, $oldAccess));
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);
        $this->assertSame('alice@example.com', $r['body']['user']['email']);

        // The calling session continues with the new tokens; every token issued before is void.
        $this->assertSame(200, $this->me('Bearer '.$r['body']['access_token'])['status']);
        $this->assertSame(401, $this->me($oldAccess)['status']);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $oldRefresh]);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $r['body']['refresh_token']]);
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());

        $this->assertSame(200, $this->login('alice@example.com', 'new-password-1'));
        $this->assertSame(401, $this->login('alice@example.com', 'password123'));
    }

    public function testChangePasswordUsesThePasswordPolicy(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        foreach (['short12', str_repeat('a', 129)] as $weak) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', [
                'newPassword' => $weak,
            ], ...$this->su($user));
            $this->assertSame(422, $r['status']);
            $this->assertSame('newPassword', $r['body']['field']);
        }
    }

    public function testChangePasswordNeedsAnExistingPasswordAndASession(): void
    {
        $sso = $this->ssoOnlyUser();
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', [
            'newPassword' => 'new-password-1',
        ], ...$this->ssoSu($sso));
        $this->assertSame(409, $r['status']);
        $this->assertSame('no_password', $r['body']['code']);
        $this->assertNull($this->user($sso->getId())->getPassword());

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', [
            'newPassword' => 'new-password-1',
        ]);
        $this->assertSame(401, $r['status']);
    }

    // --- change e-mail ---

    public function testChangeEmailSendsTheConfirmationLinkToTheNewAddressOnly(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->changeEmail($user, 'alice.new@example.com', true, ['HTTP_HOST' => '127.0.0.1:9999']);
        $this->assertSame(204, $r['status'], $r['content']);

        // The link to the new address; the current address only gets a notice without link (NoticeMailTest)
        $this->assertEmailCount(2);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'alice.new@example.com');
        $this->assertEmailAddressContains($this->getMailerMessage(1), 'to', 'alice@example.com');
        $notice = $this->getMailerMessage(1);
        $this->assertInstanceOf(Email::class, $notice);
        $this->assertStringNotContainsString('verify-new-email', (string) $notice->getHtmlBody());
        $this->assertStringNotContainsString('9999', $this->lastMailHtml());
        $token = $this->confirmTokenFromMail();

        // Hashed token, 24 hours; the account keeps its address until the link is opened.
        self::$em->clear();
        $change = self::$em->getRepository(EmailChange::class)->findOneBy([]);
        $this->assertSame(hash('sha256', $token), $change->getTokenHash());
        $this->assertEqualsWithDelta(86400, $change->getExpiresAt()->getTimestamp() - $change->getCreatedAt()->getTimestamp(), 1);
        $this->assertSame('alice@example.com', $this->user($user->getId())->getEmail());
        $this->assertSame('alice.new@example.com', $this->me($this->auth($user))['body']['pendingEmail']);
    }

    public function testConfirmationMailIsSentAfterTheResponse(): void
    {
        // Only a free address gets the mail: a synchronous SMTP round trip would tell by timing whether the
        // new address belongs to an account. The mail goes out on kernel.terminate.
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $sentBeforeTerminate = null;
        $dispatcher = static::getContainer()->get('event_dispatcher');
        $listener = function () use (&$sentBeforeTerminate): void {
            $sentBeforeTerminate ??= count($this->getMailerMessages());
        };
        $dispatcher->addListener('kernel.response', $listener, -1000);
        try {
            self::$client->disableReboot();
            $r = $this->changeEmail($user, 'alice.new@example.com');
        } finally {
            $dispatcher->removeListener('kernel.response', $listener);
            self::$client->enableReboot();
        }
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame(0, $sentBeforeTerminate);
        $this->assertEmailCount(2);
    }

    public function testChangeEmailToATakenAddressAnswersTheSameWithoutMail(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com');

        $free = $this->changeEmail($user, 'free@example.com');
        $this->assertEmailCount(2);
        // A taken address gets nothing; the current address gets its notice as for a free one
        $taken = $this->changeEmail($user, 'bob@example.com');
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'alice@example.com');
        $takenOtherCase = $this->changeEmail($user, 'BOB@example.com');
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'alice@example.com');

        $this->assertSame(204, $taken['status']);
        $this->assertSame($free['status'], $taken['status']);
        $this->assertSame($free['content'], $taken['content']);
        $this->assertSame($free['content'], $takenOtherCase['content']);
        // The pending address shows up as for a free one (else GET /me would be the oracle), but there is
        // no link that could confirm it.
        $this->assertSame('bob@example.com', $this->me($this->auth($user))['body']['pendingEmail']);
        $this->assertSame(1, self::$em->getRepository(EmailChange::class)->count([]));
    }

    public function testAddressesEqualOnlyByCollationCannotBeRequested(): void
    {
        // The unique index of user.email (utf8mb4_unicode_ci) treats "ä" like "a" and "ß" like "ss". The
        // address validation accepts only ASCII addresses, so the only collation equality left is ASCII
        // letter case, which counts as taken (see above). Non-ASCII look-alikes never get a link.
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        TestHelper::createUser(self::$em, self::$hasher, 'anna@example.com');
        foreach (['änna@example.com', 'anna@exämple.com', 'ａnna@example.com'] as $lookalike) {
            $r = $this->changeEmail($user, $lookalike);
            $this->assertSame(422, $r['status'], $lookalike);
            $this->assertSame('email', $r['body']['field']);
        }
        $this->assertEmailCount(0);
        $this->assertSame(0, self::$em->getRepository(EmailChange::class)->count([]));
    }

    public function testChangeEmailNeedsAStepUp(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $r = $this->changeEmail($user, 'alice.new@example.com', false);
        $this->assertSame(403, $r['status']);
        $this->assertSame('step_up_required', $r['body']['code']);
        // A password in the body is not a proof any more
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-email', ['email' => 'alice.new@example.com', 'password' => 'password123'], TestHelper::sessionHeader($user, self::$tokens));
        $this->assertSame('step_up_required', $r['body']['code']);
        $this->assertEmailCount(0);
        $this->assertSame(0, self::$em->getRepository(EmailChange::class)->count([]));
    }

    public function testSsoOnlyAccountChangesTheAddressWithAMailedCodeStepUp(): void
    {
        $sso = $this->ssoOnlyUser();
        $auth = TestHelper::sessionHeader($sso, self::$tokens);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-email', ['email' => 'other@example.com'], $auth);
        $this->assertSame('step_up_required', $r['body']['code']);

        [$auth, $stepUp] = $this->ssoSu($sso);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-email', ['email' => 'other@example.com'], $auth, $stepUp);
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(2);
        $this->assertEmailAddressContains($this->getMailerMessage(0), 'to', 'other@example.com');
        $this->assertEmailAddressContains($this->getMailerMessage(1), 'to', $sso->getEmail());
        $token = $this->confirmTokenFromMail();

        $this->assertSame(['status' => 'email_changed'], $this->openConfirmation($token));
        $this->assertSame('other@example.com', $this->user($sso->getId())->getEmail());
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $auth)['status']);
    }

    public function testChangeEmailValidatesTheAddress(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        foreach (['not-an-email', '', str_repeat('a', 250).'@example.com'] as $email) {
            $r = $this->changeEmail($user, $email);
            $this->assertSame(422, $r['status'], $email);
            $this->assertSame('email', $r['body']['field']);
        }
        $r = $this->changeEmail($user, 'ALICE@example.com');
        $this->assertSame(422, $r['status']);
        $this->assertSame('email', $r['body']['field']);
    }

    public function testConfirmingSwitchesTheAddressAndEndsAllSessions(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $oldAccess = $this->auth($user);
        $oldRefresh = self::$tokens->createRefreshToken($user);
        $this->changeEmail($user, 'alice.new@example.com');
        $token = $this->confirmTokenFromMail();

        $this->assertSame(['status' => 'email_changed'], $this->openConfirmation($token));
        $changed = $this->user($user->getId());
        $this->assertSame('alice.new@example.com', $changed->getEmail());
        $this->assertTrue($changed->isEmailVerified());
        $this->assertSame(1, $changed->getTokenVersion());

        // Access tokens carry the old address (and version): 401. The refresh token names the user by id,
        // but its version is old: 401 as well. The user signs in again with the new address.
        $this->assertSame(401, $this->me($oldAccess)['status']);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $oldRefresh]);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
        $this->assertSame('invalid_refresh_token', json_decode((string) self::$client->getResponse()->getContent(), true)['code']);
        $this->assertSame(401, $this->login('alice@example.com'));
        $this->assertSame(200, $this->login('alice.new@example.com'));
        $this->assertNull($this->me($this->auth($changed))['body']['pendingEmail']);
    }

    public function testOldAccessTokenCannotOpenANewAccountWithTheOldAddress(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $oldAccess = $this->auth($user);
        $this->changeEmail($user, 'alice.new@example.com');
        $this->openConfirmation($this->confirmTokenFromMail());

        // Someone registers the freed address: the old token names that address, but not that account.
        TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $this->assertSame(401, $this->me($oldAccess)['status']);
    }

    public function testConfirmationLinkWorksOnceAndExpires(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        self::mockTime('2026-10-13 09:00:00 UTC');
        $this->changeEmail($user, 'alice.new@example.com');
        $token = $this->confirmTokenFromMail();
        $this->assertSame(['status' => 'email_changed'], $this->openConfirmation($token));
        // A later second: "already used" must come from used_at, not from an UPDATE that changes nothing.
        self::mockTime('+1 minute');
        $this->assertSame(['status' => 'error', 'reason' => 'already_used', 'flow' => 'email_change'], $this->openConfirmation($token));
        $this->assertSame(['status' => 'error', 'reason' => 'invalid', 'flow' => 'email_change'], $this->openConfirmation(bin2hex(random_bytes(32))));
        $this->assertSame(['status' => 'error', 'reason' => 'invalid', 'flow' => 'email_change'], $this->openConfirmation(''));

        $other = TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com');
        self::mockTime('2026-10-13 10:00:00 UTC');
        $this->changeEmail($other, 'bob.new@example.com');
        $expiring = $this->confirmTokenFromMail();
        self::mockTime('+25 hours');
        $this->assertSame(['status' => 'error', 'reason' => 'expired', 'flow' => 'email_change'], $this->openConfirmation($expiring));
        $this->assertSame('bob@example.com', $this->user($other->getId())->getEmail());
    }

    public function testPasswordChangeOrResetDiscardsAWaitingEmailChange(): void
    {
        // Someone who knew the password started an e-mail change to their address. The owner changes or
        // resets the password: the waiting link must not move the account to that address afterwards.
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $this->changeEmail($user, 'intruder@example.com');
        $token = $this->confirmTokenFromMail();
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-password', [
            'newPassword' => 'new-password-1',
        ], ...$this->su($user));
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['status' => 'error', 'reason' => 'invalid', 'flow' => 'email_change'], $this->openConfirmation($token));
        $this->assertSame('alice@example.com', $this->user($user->getId())->getEmail());
        $this->assertNull($this->me('Bearer '.$r['body']['access_token'])['body']['pendingEmail']);

        $user = $this->user($user->getId());
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/change-email', ['email' => 'intruder@example.com'], ...$this->su($user, 'new-password-1'));
        $this->assertSame(204, $r['status'], $r['content']);
        $second = $this->confirmTokenFromMail();
        $this->assertNotSame($token, $second);
        $token = $second;
        $container = static::getContainer();
        $resetToken = $container->get(PasswordResetService::class)->createToken($container->get(EntityManagerInterface::class)->find(User::class, $user->getId()));
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/reset-password', ['token' => $resetToken, 'password' => 'new-password-2']);
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame(['status' => 'error', 'reason' => 'invalid', 'flow' => 'email_change'], $this->openConfirmation($token));
        $this->assertSame('alice@example.com', $this->user($user->getId())->getEmail());
    }

    public function testAddressTakenBeforeConfirmationIsNotSwitched(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $this->changeEmail($user, 'alice.new@example.com');
        $token = $this->confirmTokenFromMail();
        TestHelper::createUser(self::$em, self::$hasher, 'Alice.New@example.com');

        $this->assertSame(['status' => 'error', 'reason' => 'email_taken', 'flow' => 'email_change'], $this->openConfirmation($token));
        $this->assertSame('alice@example.com', $this->user($user->getId())->getEmail());
        $this->assertSame(0, $this->user($user->getId())->getTokenVersion());
    }

    public function testANewRequestReplacesAndCancelRemovesThePendingChange(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $this->changeEmail($user, 'first@example.com');
        $first = $this->confirmTokenFromMail();
        $this->changeEmail($user, 'second@example.com');
        $second = $this->confirmTokenFromMail();
        $this->assertSame('second@example.com', $this->me($this->auth($user))['body']['pendingEmail']);
        $this->assertSame('invalid', $this->openConfirmation($first)['reason']);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/change-email', [], $this->auth($user));
        $this->assertSame(204, $r['status']);
        $this->assertNull($this->me($this->auth($user))['body']['pendingEmail']);
        $this->assertSame('invalid', $this->openConfirmation($second)['reason']);
        $this->assertSame('alice@example.com', $this->user($user->getId())->getEmail());
    }

    public function testChangeEmailIsRateLimitedPerAccountWithoutChangingTheAnswer(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(204, $this->changeEmail($user, "new$i@example.com")['status']);
            $this->assertEmailCount(2);
        }
        $r = $this->changeEmail($user, 'new5@example.com');
        $this->assertSame(204, $r['status']);
        $this->assertEmailCount(0);
        // Still the step-up check first.
        $this->assertSame('step_up_required', $this->changeEmail($user, 'new6@example.com', false)['body']['code']);
    }

    public function testConfirmationTokenNeverReachesTheLog(): void
    {
        $log = static::getContainer()->getParameter('kernel.logs_dir').'/test.log';
        $before = is_file($log) ? (int) filesize($log) : 0;
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $this->changeEmail($user, 'alice.new@example.com');
        $token = $this->confirmTokenFromMail();
        $this->openConfirmation($token);
        $this->openConfirmation($token);
        $written = is_file($log) ? (string) file_get_contents($log, false, null, $before) : '';
        $this->assertStringNotContainsString($token, $written);
        // Logged request URIs (written when a request also logs an error) lose the token as well.
        static::getContainer()->get('logger')->error('Matched route', ['request_uri' => self::$backendUrl.'/api/auth/verify-new-email?token='.$token]);
        $written = (string) file_get_contents($log, false, null, $before);
        $this->assertStringContainsString('verify-new-email?token=[redacted]', $written);
        $this->assertStringNotContainsString($token, $written);
    }

    public function testPruneCommandAlsoDeletesExpiredEmailChanges(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, 'alice@example.com');
        $this->changeEmail($user, 'alice.new@example.com');
        self::$em->getConnection()->executeStatement("UPDATE email_change SET expires_at = '2000-01-01 00:00:00'");
        $other = TestHelper::createUser(self::$em, self::$hasher, 'bob@example.com');
        $this->changeEmail($other, 'bob.new@example.com');

        $tester = new CommandTester((new Application(self::$client->getKernel()))->find('app:prune-password-resets'));
        $this->assertSame(0, $tester->execute([]));
        self::$em->clear();
        $left = array_map(fn (EmailChange $c) => $c->getNewEmail(), self::$em->getRepository(EmailChange::class)->findAll());
        $this->assertSame(['bob.new@example.com'], $left);
    }

    // --- last calendar per membership ---

    public function testLastCalendarIsRememberedPerMembership(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $clubA = TestHelper::createClub(self::$em, $user, 'A');
        $calA1 = TestHelper::createCalendar(self::$em, $clubA, 'A1');
        $calA2 = TestHelper::createCalendar(self::$em, $clubA, 'A2');
        $clubB = TestHelper::createClub(self::$em, $user, 'B');
        $calB = TestHelper::createCalendar(self::$em, $clubB, 'B1');
        $auth = $this->auth($user);

        foreach ([[$clubA, $calA2], [$clubB, $calB]] as [$club, $calendar]) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', [
                'lastClubId' => $club->getId(), 'lastCalendarId' => $calendar->getId(),
            ], $auth);
            $this->assertSame(200, $r['status'], $r['content']);
        }

        $clubs = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth)['body'];
        $byName = array_column($clubs, 'lastCalendarId', 'name');
        $this->assertSame(['A' => $calA2->getId(), 'B' => $calB->getId()], $byName);
        $this->assertNotSame($calA1->getId(), $byName['A']);
        // The user-level pair stays as before (last club/calendar overall).
        $this->assertSame($calB->getId(), $this->me($auth)['body']['lastCalendarId']);
    }

    public function testForeignOrUnknownLastIdsAreRejected(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user, 'Mine');
        $mine = TestHelper::createCalendar(self::$em, $club, 'Mine');
        $stranger = TestHelper::createUser(self::$em, self::$hasher);
        $foreignClub = TestHelper::createClub(self::$em, $stranger, 'Foreign');
        $foreign = TestHelper::createCalendar(self::$em, $foreignClub, 'Foreign');
        $auth = $this->auth($user);

        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['lastClubId' => $club->getId(), 'lastCalendarId' => $mine->getId()], $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        foreach ([
            [['lastClubId' => $foreignClub->getId()], 'lastClubId'],
            [['lastClubId' => 'no-such-club'], 'lastClubId'],
            [['lastCalendarId' => $foreign->getId()], 'lastCalendarId'],
            [['lastClubId' => $foreignClub->getId(), 'lastCalendarId' => $foreign->getId()], 'lastClubId'],
            [['lastClubId' => $club->getId(), 'lastCalendarId' => $foreign->getId()], 'lastCalendarId'],
            [['lastClubId' => $foreignClub->getId(), 'lastCalendarId' => $mine->getId()], 'lastClubId'],
            [['lastClubId' => $club->getId(), 'lastCalendarId' => 'no-such-calendar'], 'lastCalendarId'],
        ] as [$body, $field]) {
            $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', $body + ['name' => 'Changed'], $auth);
            $this->assertSame(422, $r['status'], $r['content']);
            $this->assertSame('unknown_reference', $r['body']['code']);
            $this->assertSame($field, $r['body']['field']);
        }

        $me = $this->me($auth)['body'];
        $this->assertSame($club->getId(), $me['lastClubId']);
        $this->assertSame($mine->getId(), $me['lastCalendarId']);
        $this->assertNotSame('Changed', $me['name']);
        $foreignClubs = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $this->auth($stranger))['body'];
        $this->assertSame([null], array_column($foreignClubs, 'lastCalendarId'));
    }

    public function testCalendarOfAnotherClubThanTheNamedOneIsNotStored(): void
    {
        // Member of both clubs: a pair whose calendar belongs to the other club is ignored, and a stored
        // id that does not belong to the club (written outside the API) is never reported.
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $clubA = TestHelper::createClub(self::$em, $user, 'A');
        $clubB = TestHelper::createClub(self::$em, $user, 'B');
        $calB = TestHelper::createCalendar(self::$em, $clubB, 'B1');
        $auth = $this->auth($user);

        $r = TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['lastClubId' => $clubA->getId(), 'lastCalendarId' => $calB->getId()], $auth);
        $this->assertSame(422, $r['status']);
        $clubs = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth)['body'];
        $this->assertSame(['A' => null, 'B' => null], array_column($clubs, 'lastCalendarId', 'name'));

        self::$em->getConnection()->executeStatement(
            'UPDATE club_user SET last_calendar_id = ? WHERE club_id = ?',
            [$calB->getId(), $clubA->getId()],
        );
        $clubs = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth)['body'];
        $this->assertSame(['A' => null, 'B' => null], array_column($clubs, 'lastCalendarId', 'name'));
    }

    public function testDeletedCalendarIsNoLongerReported(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $club = TestHelper::createClub(self::$em, $user);
        $calendar = TestHelper::createCalendar(self::$em, $club);
        $auth = $this->auth($user);
        TestHelper::jsonRequest(self::$client, 'PATCH', '/api/auth/me', ['lastClubId' => $club->getId(), 'lastCalendarId' => $calendar->getId()], $auth);

        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/clubs/'.$club->getId().'/calendars/'.$calendar->getId(), [], $auth);
        $this->assertLessThan(300, $r['status'], $r['content']);
        $clubs = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $auth)['body'];
        $this->assertSame([null], array_column($clubs, 'lastCalendarId'));
    }
}
