<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Club invitations (security audit M8): no member without consent, no account enumeration, 7 days validity,
 * re-send only after expiry, token only identifies an invitation (the verified address must match).
 */
class InvitationTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    protected function setUp(): void
    {
        // A fresh kernel per test: a transaction that fails in a request closes the entity manager, and the mailer
        // assertions need the kernel of the client.
        self::ensureKernelShutdown();
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
        self::$em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
        // Keep the kernel alive until the assertions are done (see PasswordResetTest); setUp starts a new one.
    }

    // --- helpers ---

    /** @return array{owner: User, club: Club, auth: string, url: string} */
    private function club(string $name = 'Schützenverein'): array
    {
        $owner = TestHelper::createUser(self::$em, self::$hasher, 'owner@example.com');
        $owner->setName('Olga Owner');
        self::$em->flush();
        $club = TestHelper::createClub(self::$em, $owner, $name);

        return ['owner' => $owner, 'club' => $club, 'auth' => $this->auth($owner), 'url' => "/api/clubs/{$club->getId()}/invitations"];
    }

    private function addMember(array $c, User $user): void
    {
        self::$em->persist((new ClubUser())
            ->setClub(self::$em->getReference(Club::class, $c['club']->getId()))
            ->setUser(self::$em->getReference(User::class, $user->getId())));
        self::$em->flush();
    }

    private function auth(User $user): string
    {
        return TestHelper::authHeader($user, self::$tokens);
    }

    private function user(string $email, bool $verified = true, string $name = 'Ina Invitee'): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email, 'password123', $verified);
        $user->setName($name);
        self::$em->flush();

        return $user;
    }

    /** @return array{status: int, body: mixed, content: string, headers: array<string, list<string>>} */
    private function req(string $method, string $uri, string $auth = '', array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, $auth);
    }

    /** @return list<Email> */
    private function mails(): array
    {
        return array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
    }

    /** The token of the one mail sent by the last request. */
    private function mailedToken(): string
    {
        $mails = $this->mails();
        $this->assertCount(1, $mails);
        $this->assertSame(1, preg_match('#/invitations\?token=([0-9a-f]{64})#', (string) $mails[0]->getHtmlBody(), $m));

        return $m[1];
    }

    /** Invites and returns [invitation id, token]. */
    private function invite(array $club, string $email): array
    {
        $r = $this->req('POST', $club['url'], $club['auth'], ['email' => $email]);
        $this->assertSame(204, $r['status'], $r['content']);
        $token = $this->mailedToken();
        self::$em->clear();
        $invitation = self::$em->getRepository(ClubInvitation::class)->findOneBy(['tokenHash' => hash('sha256', $token)]);
        $this->assertNotNull($invitation);

        return [$invitation->getId(), $token];
    }

    private function expire(string $id, string $when = '-1 minute'): void
    {
        self::$em->getConnection()->executeStatement(
            'UPDATE club_invitation SET expires_at = ? WHERE id = ?',
            [(new \DateTimeImmutable($when, new \DateTimeZone('UTC')))->format('Y-m-d H:i:s'), $id],
        );
        self::$em->clear();
    }

    private function rows(array $criteria = []): int
    {
        self::$em->clear();

        return self::$em->getRepository(ClubInvitation::class)->count($criteria);
    }

    private function assertCode(int $status, string $code, array $r): void
    {
        $this->assertSame($status, $r['status'], $r['content']);
        $this->assertSame($code, $r['body']['code'] ?? null, $r['content']);
    }

    // --- creating ---

    public function testInvitingStoresHashedTokenAndMailsOnlyClubAndInviterName(): void
    {
        $c = $this->club('Schützenverein');
        $r = $this->req('POST', $c['url'], $c['auth'], ['email' => 'New.Person@Example.COM']);
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame('', $r['content']);

        $token = $this->mailedToken();
        $mail = $this->mails()[0];
        $this->assertSame('new.person@example.com', $mail->getTo()[0]->getAddress());
        $html = (string) $mail->getHtmlBody();
        $this->assertStringContainsString('Schützenverein', $html);
        $this->assertStringContainsString('Olga Owner', $html);
        $this->assertStringContainsString(rtrim((string) $_ENV['FRONTEND_URL'], '/').'/signup', $html);
        $this->assertStringNotContainsString('owner@example.com', $html);
        $this->assertStringContainsString('Schützenverein', (string) $mail->getSubject());

        self::$em->clear();
        $rows = self::$em->getRepository(ClubInvitation::class)->findAll();
        $this->assertCount(1, $rows);
        $row = $rows[0];
        $this->assertSame('new.person@example.com', $row->getEmail());
        $this->assertSame(hash('sha256', $token), $row->getTokenHash());
        $this->assertNotSame($token, $row->getTokenHash());
        $this->assertSame(ClubInvitation::PENDING, $row->getStatus());
        $this->assertSame($c['owner']->getId(), $row->getInvitedBy()->getId());
        $this->assertEqualsWithDelta(7 * 86400, $row->getExpiresAt()->getTimestamp() - $row->getCreatedAt()->getTimestamp(), 1);
        $this->assertEqualsWithDelta(time() + 7 * 86400, $row->getExpiresAt()->getTimestamp(), 30);
        $this->assertSame(36, strlen($row->getId()));
    }

    public function testTheAnswerIsIdenticalForUnknownRegisteredUnverifiedMemberAndAlreadyInvitedAddresses(): void
    {
        $c = $this->club();
        $this->user('registered@example.com');
        $this->user('claimed@example.com', false);
        $member = $this->user('member@example.com');
        self::$em->persist((new ClubUser())->setClub($c['club'])->setUser($member));
        self::$em->flush();

        $answers = [];
        $mailCounts = [];
        foreach (['unknown@example.com', 'registered@example.com', 'claimed@example.com', 'member@example.com', 'MEMBER@example.com', 'unknown@example.com'] as $email) {
            $r = $this->req('POST', $c['url'], $c['auth'], ['email' => $email]);
            $answers[$email.count($answers)] = [$r['status'], $r['content'], $r['headers']['content-type'] ?? null];
            $mailCounts[] = count($this->mails());
        }
        $this->assertCount(1, array_unique(array_map('serialize', $answers)), 'identical status, body and headers');
        $this->assertSame(204, array_values($answers)[0][0]);
        // mails: unknown, registered, unverified yes; members and the duplicate no
        $this->assertSame([1, 1, 1, 0, 0, 0], $mailCounts);
        $this->assertSame(3, $this->rows());
        $this->assertSame(0, $this->rows(['email' => 'member@example.com']));
    }

    public function testInvitingAgainWhilePendingSendsNoSecondMailAndKeepsTheToken(): void
    {
        $c = $this->club();
        [$id, $token] = $this->invite($c, 'a@example.com');
        $this->assertSame(204, $this->req('POST', $c['url'], $c['auth'], ['email' => 'A@example.com'])['status']);
        $this->assertCount(0, $this->mails());
        $this->assertSame(1, $this->rows());
        // the first token still works
        $this->assertSame(200, $this->req('POST', '/api/invitations/accept', $this->auth($this->user('a@example.com')), ['token' => $token])['status']);
    }

    public function testInvitingAnAddressWithAnExpiredInvitationRenewsIt(): void
    {
        $c = $this->club();
        [$id, $oldToken] = $this->invite($c, 'a@example.com');
        $this->expire($id);
        $this->assertSame(204, $this->req('POST', $c['url'], $c['auth'], ['email' => 'a@example.com'])['status']);
        $newToken = $this->mailedToken();
        $this->assertNotSame($oldToken, $newToken);
        $this->assertSame(1, $this->rows());
        $a = $this->auth($this->user('a@example.com'));
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', '/api/invitations/accept', $a, ['token' => $oldToken]));
        $this->assertSame(200, $this->req('POST', '/api/invitations/accept', $a, ['token' => $newToken])['status']);
    }

    public function testAnsweredInvitationsDoNotBlockANewInvitation(): void
    {
        $c = $this->club();
        [$id] = $this->invite($c, 'a@example.com');
        $a = $this->user('a@example.com');
        $this->assertSame(204, $this->req('POST', "/api/invitations/$id/decline", $this->auth($a))['status']);
        $this->invite($c, 'a@example.com');
        $this->assertSame(2, $this->rows());
    }

    public function testCreateIsGuardedAndValidated(): void
    {
        $c = $this->club();
        $outsider = $this->user('outsider@example.com');
        $this->assertCode(401, 'missing_token', $this->req('POST', $c['url'], '', ['email' => 'x@example.com']));
        $this->assertSame(403, $this->req('POST', $c['url'], $this->auth($outsider), ['email' => 'x@example.com'])['status']);
        $this->assertSame(403, $this->req('GET', $c['url'], $this->auth($outsider))['status']);
        $this->assertCode(401, 'missing_token', $this->req('GET', $c['url']));
        $this->assertCode(422, 'validation_failed', $this->req('POST', $c['url'], $c['auth'], ['email' => 'not-an-address']));
        $this->assertCode(422, 'validation_failed', $this->req('POST', $c['url'], $c['auth'], ['email' => '']));
        self::$client->request('POST', $c['url'], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $c['auth']], '{kaputt');
        $this->assertSame(400, self::$client->getResponse()->getStatusCode());
        $this->assertSame(404, $this->req('POST', '/api/clubs/00000000-0000-7000-8000-000000000000/invitations', $c['auth'], ['email' => 'x@example.com'])['status']);
        $this->assertSame(0, $this->rows());
    }

    public function testTheOldDirectAddMemberEndpointIsGone(): void
    {
        $c = $this->club();
        $this->user('victim@example.com');
        $r = $this->req('POST', "/api/clubs/{$c['club']->getId()}/members", $c['auth'], ['email' => 'victim@example.com']);
        $this->assertSame(405, $r['status'], $r['content']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
    }

    // --- listing, re-send, revoke ---

    public function testListShowsPendingAndExpiredButNotAnsweredInvitations(): void
    {
        $c = $this->club();
        [$pendingId] = $this->invite($c, 'pending@example.com');
        [$expiredId] = $this->invite($c, 'expired@example.com');
        [$declinedId] = $this->invite($c, 'declined@example.com');
        $this->expire($expiredId);
        $this->req('POST', "/api/invitations/$declinedId/decline", $this->auth($this->user('declined@example.com')));

        $r = $this->req('GET', $c['url'], $c['auth']);
        $this->assertSame(200, $r['status'], $r['content']);
        $byEmail = array_column($r['body'], null, 'email');
        $this->assertEqualsCanonicalizing(['expired@example.com', 'pending@example.com'], array_keys($byEmail));
        $this->assertCount(2, $r['body']);
        $this->assertSame('pending', $byEmail['pending@example.com']['status']);
        $this->assertSame('expired', $byEmail['expired@example.com']['status']);
        $this->assertSame($pendingId, $byEmail['pending@example.com']['id']);
        $this->assertSame('Olga Owner', $byEmail['pending@example.com']['invitedByName']);
        $this->assertEqualsCanonicalizing(['id', 'email', 'status', 'invitedByName', 'createdAt', 'expiresAt'], array_keys($byEmail['pending@example.com']));
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $byEmail['pending@example.com']['expiresAt']);
        $this->assertStringNotContainsString('token', strtolower($r['content']));
    }

    public function testResendIsRefusedBeforeExpiryAndWorksAfterwards(): void
    {
        $c = $this->club();
        [$id, $oldToken] = $this->invite($c, 'a@example.com');

        $early = $this->req('POST', "{$c['url']}/$id/resend", $c['auth']);
        $this->assertCode(422, 'invitation_not_expired', $early);
        $this->assertCount(0, $this->mails());
        $this->assertSame(0, $this->rows(['status' => 'expired']));

        $this->expire($id);
        $r = $this->req('POST', "{$c['url']}/$id/resend", $c['auth']);
        $this->assertSame(204, $r['status'], $r['content']);
        $newToken = $this->mailedToken();
        $this->assertNotSame($oldToken, $newToken);

        self::$em->clear();
        $row = self::$em->find(ClubInvitation::class, $id);
        $this->assertEqualsWithDelta(time() + 7 * 86400, $row->getExpiresAt()->getTimestamp(), 30);
        $this->assertSame(hash('sha256', $newToken), $row->getTokenHash());
        $listed = $this->req('GET', $c['url'], $c['auth'])['body'];
        $this->assertSame('pending', $listed[0]['status']);

        // The old token is dead, the new one works
        $a = $this->auth($this->user('a@example.com'));
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', '/api/invitations/accept', $a, ['token' => $oldToken]));
        $this->assertSame(200, $this->req('POST', '/api/invitations/accept', $a, ['token' => $newToken])['status']);
        // and a renewed invitation is again too early for another re-send (it is answered now: 404)
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "{$c['url']}/$id/resend", $c['auth']));
    }

    public function testResendAndRevokeStayInsideTheClub(): void
    {
        $c = $this->club();
        [$id] = $this->invite($c, 'a@example.com');
        $this->expire($id);
        $other = TestHelper::createUser(self::$em, self::$hasher, 'other-owner@example.com');
        $otherClub = TestHelper::createClub(self::$em, $other, 'Anderer Verein');
        $otherUrl = "/api/clubs/{$otherClub->getId()}/invitations";
        $otherAuth = $this->auth($other);

        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "$otherUrl/$id/resend", $otherAuth));
        $this->assertCode(404, 'invitation_not_found', $this->req('DELETE', "$otherUrl/$id", $otherAuth));
        $this->assertSame(403, $this->req('POST', "{$c['url']}/$id/resend", $otherAuth)['status']);
        $this->assertSame(403, $this->req('DELETE', "{$c['url']}/$id", $otherAuth)['status']);
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "{$c['url']}/unknown/resend", $c['auth']));
        $this->assertSame(1, $this->rows());
    }

    public function testRevokeDeletesPendingAndExpiredInvitationsAndKillsTheToken(): void
    {
        $c = $this->club();
        [$pending, $pendingToken] = $this->invite($c, 'p@example.com');
        [$expired] = $this->invite($c, 'e@example.com');
        $this->expire($expired);

        $r = $this->req('DELETE', "{$c['url']}/$pending", $c['auth']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['ok' => true], $r['body']);
        $this->assertSame(200, $this->req('DELETE', "{$c['url']}/$expired", $c['auth'])['status']);
        $this->assertSame(0, $this->rows());
        $this->assertCode(404, 'invitation_not_found', $this->req('DELETE', "{$c['url']}/$pending", $c['auth']));
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', '/api/invitations/accept', $this->auth($this->user('p@example.com')), ['token' => $pendingToken]));
    }

    public function testAnotherMemberCanManageInvitations(): void
    {
        $c = $this->club();
        $second = $this->user('second@example.com', true, 'Sam Second');
        self::$em->persist((new ClubUser())->setClub($c['club'])->setUser($second));
        self::$em->flush();
        $this->invite($c, 'a@example.com');
        $listed = $this->req('GET', $c['url'], $this->auth($second));
        $this->assertSame(200, $listed['status']);
        $this->assertSame(200, $this->req('DELETE', "{$c['url']}/{$listed['body'][0]['id']}", $this->auth($second))['status']);
        $this->assertSame(0, $this->rows());
    }

    // --- the invitee ---

    public function testInviteeListShowsOnlyOwnNonExpiredInvitationsWithMinimalData(): void
    {
        $c = $this->club('Schützenverein');
        [$id] = $this->invite($c, 'ina@example.com');
        $other = TestHelper::createUser(self::$em, self::$hasher, 'o2@example.com');
        $club2 = TestHelper::createClub(self::$em, $other, 'Zweiter Verein');
        $second = ['auth' => $this->auth($other), 'url' => "/api/clubs/{$club2->getId()}/invitations"];
        [$secondId] = $this->invite($second, 'INA@example.com');
        [$foreign] = $this->invite($second, 'someone-else@example.com');
        $this->expire($secondId, '-1 second');

        $ina = $this->user('Ina@Example.com');
        $r = $this->req('GET', '/api/invitations', $this->auth($ina));
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertCount(1, $r['body']);
        $this->assertSame(['id', 'clubName', 'invitedByName', 'expiresAt'], array_keys($r['body'][0]));
        $this->assertSame($id, $r['body'][0]['id']);
        $this->assertSame('Schützenverein', $r['body'][0]['clubName']);
        $this->assertSame('Olga Owner', $r['body'][0]['invitedByName']);
        $this->assertStringNotContainsString($c['club']->getId(), $r['content']);
        $this->assertStringNotContainsString('Zweiter Verein', $r['content']);
    }

    public function testUnverifiedUsersNeverSeeOrAcceptInvitations(): void
    {
        $c = $this->club();
        [$id, $token] = $this->invite($c, 'claimed@example.com');
        $claimed = $this->user('claimed@example.com', false);
        $auth = $this->auth($claimed);

        $r = $this->req('GET', '/api/invitations', $auth);
        $this->assertSame([], $r['body']);
        foreach ([
            ['POST', "/api/invitations/$id/accept", []],
            ['POST', "/api/invitations/$id/decline", []],
            ['POST', '/api/invitations/accept', ['token' => $token]],
            ['POST', '/api/invitations/decline', ['token' => $token]],
        ] as [$method, $uri, $body]) {
            $this->assertCode(404, 'invitation_not_found', $this->req($method, $uri, $auth, $body));
        }
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
        $this->assertSame(ClubInvitation::PENDING, self::$em->find(ClubInvitation::class, $id)->getStatus());

        // once the address is proven the invitation is discovered, nothing was auto-accepted
        $claimed = self::$em->getRepository(User::class)->findOneBy(['email' => 'claimed@example.com']);
        $claimed->setIsEmailVerified(true);
        self::$em->flush();
        $this->assertCount(1, $this->req('GET', '/api/invitations', $auth)['body']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
    }

    public function testAcceptByIdCreatesTheMembershipOnce(): void
    {
        $c = $this->club('Schützenverein');
        [$id] = $this->invite($c, 'ina@example.com');
        $ina = $this->user('ina@example.com');
        $auth = $this->auth($ina);

        $r = $this->req('POST', "/api/invitations/$id/accept", $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['id' => $c['club']->getId(), 'name' => 'Schützenverein', 'timezone' => 'Europe/Berlin'], $r['body']);
        self::$em->clear();
        $this->assertNotNull(self::$em->getRepository(ClubUser::class)->findOneBy(['club' => $c['club']->getId(), 'user' => $ina->getId()]));
        $row = self::$em->find(ClubInvitation::class, $id);
        $this->assertSame(ClubInvitation::ACCEPTED, $row->getStatus());
        $this->assertNotNull($row->getResolvedAt());

        // A new member can use the club; the invitation is gone from both lists; a second accept is a 404
        $this->assertSame(200, $this->req('GET', "/api/clubs/{$c['club']->getId()}", $auth)['status']);
        $this->assertSame([], $this->req('GET', '/api/invitations', $auth)['body']);
        $this->assertSame([], $this->req('GET', $c['url'], $c['auth'])['body']);
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "/api/invitations/$id/accept", $auth));
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "/api/invitations/$id/decline", $auth));
    }

    public function testAcceptByTokenWorksForTheInvitedAddressCaseInsensitively(): void
    {
        $c = $this->club();
        [, $token] = $this->invite($c, 'Mixed.Case@example.com');
        $user = $this->user('mixed.case@EXAMPLE.com');
        $r = $this->req('POST', '/api/invitations/accept', $this->auth($user), ['token' => $token]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame($c['club']->getId(), $r['body']['id']);
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', '/api/invitations/accept', $this->auth($user), ['token' => $token]));
    }

    public function testAddressesThatDifferOnlyByAccentsAreNotTheSameInSql(): void
    {
        // The validators may reject non-ASCII addresses; the rows are created directly to test the matching
        // (user.email and club_invitation.email are looser collations than the strict PHP comparison would be).
        $c = $this->club();
        [$id] = $this->invite($c, 'jose@example.com');
        $jose = $this->user('josé@example.com');
        $this->assertSame([], $this->req('GET', '/api/invitations', $this->auth($jose))['body']);
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "/api/invitations/$id/accept", $this->auth($jose)));

        // A member josé does not count as the already-member address jose
        $this->addMember($c, $jose);
        $r = $this->req('POST', $c['url'], $c['auth'], ['email' => 'jose@example.com']);
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame(1, $this->rows(['email' => 'jose@example.com']));
        self::$em->getConnection()->executeStatement("DELETE FROM club_invitation WHERE email = 'jose@example.com'");
        $r = $this->req('POST', $c['url'], $c['auth'], ['email' => 'jose@example.com']);
        $this->assertSame(204, $r['status'], $r['content']);
        $this->assertSame(1, $this->rows(['email' => 'jose@example.com']), 'jose is not a member just because josé is');

        // the column compares binary, also for stored values
        $this->assertSame(0, $this->rows(['email' => 'josé@example.com']));
    }

    public function testRevokeAndAnswerRaceAnswersNotFoundInsteadOfFailing(): void
    {
        $c = $this->club();
        [$id] = $this->invite($c, 'ina@example.com');
        $ina = $this->user('ina@example.com');
        $this->assertSame(200, $this->req('DELETE', "{$c['url']}/$id", $c['auth'])['status']);
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "/api/invitations/$id/accept", $this->auth($ina)));
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "/api/invitations/$id/decline", $this->auth($ina)));
    }

    public function testATokenCannotBeUsedByAnotherUser(): void
    {
        $c = $this->club();
        [$id, $token] = $this->invite($c, 'ina@example.com');
        $thief = $this->user('thief@example.com', true, 'Thief');
        $auth = $this->auth($thief);

        $wrongToken = $this->req('POST', '/api/invitations/accept', $auth, ['token' => str_repeat('0', 64)]);
        foreach ([
            $this->req('POST', '/api/invitations/accept', $auth, ['token' => $token]),
            $this->req('POST', '/api/invitations/decline', $auth, ['token' => $token]),
            $this->req('POST', "/api/invitations/$id/accept", $auth),
            $this->req('POST', "/api/invitations/$id/decline", $auth),
            $wrongToken,
            $this->req('POST', '/api/invitations/00000000-0000-7000-8000-000000000000/accept', $auth),
        ] as $r) {
            $this->assertCode(404, 'invitation_not_found', $r);
            $this->assertSame($wrongToken['body'], $r['body'], 'no oracle between wrong token, wrong user and unknown id');
        }
        $this->assertSame([], $this->req('GET', '/api/invitations', $auth)['body']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
        $this->assertSame(ClubInvitation::PENDING, self::$em->find(ClubInvitation::class, $id)->getStatus());

        // the invitation is untouched and still works for the invited address
        $this->assertSame(200, $this->req('POST', '/api/invitations/accept', $this->auth($this->user('ina@example.com')), ['token' => $token])['status']);
    }

    public function testTokenRequestsAreValidated(): void
    {
        $user = $this->user('ina@example.com');
        $auth = $this->auth($user);
        $this->assertCode(401, 'missing_token', $this->req('GET', '/api/invitations'));
        $this->assertCode(401, 'missing_token', $this->req('POST', '/api/invitations/accept', '', ['token' => 'x']));
        $this->assertCode(401, 'missing_token', $this->req('POST', '/api/invitations/abc/accept'));
        $this->assertCode(422, 'validation_failed', $this->req('POST', '/api/invitations/accept', $auth, ['token' => '']));
        $this->assertCode(422, 'validation_failed', $this->req('POST', '/api/invitations/decline', $auth, ['token' => str_repeat('a', 129)]));
        self::$client->request('POST', '/api/invitations/accept', [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $auth], '{kaputt');
        $this->assertSame(400, self::$client->getResponse()->getStatusCode());
    }

    public function testExpiredInvitationsCannotBeAnsweredAndDisappearFromTheInviteeList(): void
    {
        $c = $this->club();
        [$id, $token] = $this->invite($c, 'ina@example.com');
        $this->expire($id, '-1 second');
        $ina = $this->user('ina@example.com');
        $auth = $this->auth($ina);

        $this->assertSame([], $this->req('GET', '/api/invitations', $auth)['body']);
        $this->assertCode(422, 'invitation_expired', $this->req('POST', "/api/invitations/$id/accept", $auth));
        $this->assertCode(422, 'invitation_expired', $this->req('POST', '/api/invitations/accept', $auth, ['token' => $token]));
        $this->assertCode(422, 'invitation_expired', $this->req('POST', "/api/invitations/$id/decline", $auth));
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
        $this->assertSame('expired', $this->req('GET', $c['url'], $c['auth'])['body'][0]['status']);
    }

    public function testInvitationExpiresSevenDaysAfterCreation(): void
    {
        $c = $this->club();
        [$id] = $this->invite($c, 'ina@example.com');
        $auth = $this->auth($this->user('ina@example.com'));
        $this->expire($id, '+6 days 23 hours');
        $this->assertCount(1, $this->req('GET', '/api/invitations', $auth)['body']);
        $this->assertSame('pending', $this->req('GET', $c['url'], $c['auth'])['body'][0]['status']);
        $this->expire($id, '-1 second');
        $this->assertSame([], $this->req('GET', '/api/invitations', $auth)['body']);
    }

    public function testDeclineByIdAndByTokenAddsNoMemberAndRemovesTheInvitation(): void
    {
        $c = $this->club();
        [$id1] = $this->invite($c, 'a@example.com');
        [, $token2] = $this->invite($c, 'b@example.com');
        $a = $this->auth($this->user('a@example.com'));
        $b = $this->auth($this->user('b@example.com'));

        $r = $this->req('POST', "/api/invitations/$id1/decline", $a);
        $this->assertSame(204, $r['status'], $r['content']);
        $r = $this->req('POST', '/api/invitations/decline', $b, ['token' => $token2]);
        $this->assertSame(204, $r['status'], $r['content']);
        self::$em->clear();
        $this->assertSame(1, self::$em->getRepository(ClubUser::class)->count([]));
        $this->assertSame(2, $this->rows(['status' => ClubInvitation::DECLINED]));
        $this->assertSame([], $this->req('GET', '/api/invitations', $a)['body']);
        $this->assertSame([], $this->req('GET', $c['url'], $c['auth'])['body']);
        $this->assertCode(404, 'invitation_not_found', $this->req('POST', "/api/invitations/$id1/accept", $a));
        $this->assertSame(403, $this->req('GET', "/api/clubs/{$c['club']->getId()}", $a)['status']);
    }

    public function testAcceptingWhileAlreadyAMemberIsIdempotent(): void
    {
        $c = $this->club();
        [$id] = $this->invite($c, 'ina@example.com');
        $ina = $this->user('ina@example.com');
        $this->addMember($c, $ina);
        $r = $this->req('POST', "/api/invitations/$id/accept", $this->auth($ina));
        $this->assertSame(200, $r['status'], $r['content']);
        self::$em->clear();
        $this->assertSame(2, self::$em->getRepository(ClubUser::class)->count([]));
    }

    public function testUsersWithoutClubsWorkEverywhere(): void
    {
        $user = $this->user('new@example.com');
        $auth = $this->auth($user);
        $this->assertSame([], $this->req('GET', '/api/clubs', $auth)['body']);
        $this->assertSame([], $this->req('GET', '/api/invitations', $auth)['body']);
        $this->assertSame(200, $this->req('GET', '/api/auth/me', $auth)['status']);
    }

    // --- limits ---

    public function testInvitationsArePerUserRateLimited(): void
    {
        $c = $this->club();
        for ($i = 1; $i <= 20; ++$i) {
            $this->assertSame(204, $this->req('POST', $c['url'], $c['auth'], ['email' => "p$i@example.com"])['status'], "invitation $i");
        }
        $r = $this->req('POST', $c['url'], $c['auth'], ['email' => 'p21@example.com']);
        $this->assertCode(429, 'rate_limited', $r);
        $this->assertArrayHasKey('retry-after', $r['headers']);
        $this->assertSame(20, $this->rows());

        // re-send counts against the same limit; another member has a limit of their own
        $second = $this->user('second@example.com');
        $this->addMember($c, $second);
        $this->assertSame(204, $this->req('POST', $c['url'], $this->auth($second), ['email' => 'x1@example.com'])['status']);
        $this->assertCode(429, 'rate_limited', $this->req('POST', "{$c['url']}/00000000-0000-7000-8000-000000000000/resend", $c['auth']));
    }

    public function testInvitationsArePerClubRateLimited(): void
    {
        $c = $this->club();
        $users = [];
        foreach ([1, 2, 3] as $n) {
            $u = $this->user("member$n@example.com");
            self::$em->persist((new ClubUser())->setClub($c['club'])->setUser($u));
            $users[] = $this->auth($u);
        }
        self::$em->flush();
        $sent = 0;
        foreach ($users as $auth) {
            for ($i = 0; $i < 20 && $sent < 50; ++$i, ++$sent) {
                $this->assertSame(204, $this->req('POST', $c['url'], $auth, ['email' => "q$sent@example.com"])['status'], "invitation $sent");
            }
        }
        $this->assertSame(50, $sent);
        $this->assertCode(429, 'rate_limited', $this->req('POST', $c['url'], $users[2], ['email' => 'q51@example.com']));
    }

    public function testOneAddressGetsAtMostFiveInvitationMailsPerDayButTheAnswerStaysTheSame(): void
    {
        $c = $this->club();
        [$id] = $this->invite($c, 'target@example.com');
        $mails = 1;
        for ($i = 0; $i < 5; ++$i) {
            $this->expire($id);
            $r = $this->req('POST', $c['url'], $c['auth'], ['email' => 'target@example.com']);
            $this->assertSame(204, $r['status'], $r['content']);
            $mails += count($this->mails());
        }
        $this->assertSame(5, $mails, 'the sixth mail is dropped silently');
        $this->assertSame(1, $this->rows());
    }

    // --- consistency with other data ---

    public function testDeletingTheInvitersAccountKeepsTheInvitationWithoutName(): void
    {
        $c = $this->club();
        $second = $this->user('second@example.com', true, 'Sam Second');
        self::$em->persist((new ClubUser())->setClub($c['club'])->setUser($second));
        self::$em->flush();
        $secondClub = ['auth' => $this->auth($second), 'url' => $c['url']];
        $this->invite($secondClub, 'ina@example.com');

        $r = $this->req('DELETE', '/api/auth/me', $secondClub['auth'], ['password' => 'password123']);
        $this->assertSame(200, $r['status'], $r['content']);
        $listed = $this->req('GET', $c['url'], $c['auth'])['body'];
        $this->assertCount(1, $listed);
        $this->assertNull($listed[0]['invitedByName']);
        $ina = $this->user('ina@example.com');
        $this->assertNull($this->req('GET', '/api/invitations', $this->auth($ina))['body'][0]['invitedByName']);
    }

    public function testDeletingTheClubDeletesItsInvitations(): void
    {
        $c = $this->club();
        $this->invite($c, 'ina@example.com');
        $this->assertSame(200, $this->req('DELETE', "/api/clubs/{$c['club']->getId()}", $c['auth'])['status']);
        $this->assertSame(0, $this->rows());
    }

    // --- prune ---

    public function testPruneCommandDeletesOldAnsweredAndLongExpiredInvitations(): void
    {
        $c = $this->club();
        $ids = [];
        foreach (['fresh', 'expired-recent', 'expired-old', 'declined-old', 'declined-recent', 'accepted-old'] as $name) {
            [$ids[$name]] = $this->invite($c, "$name@example.com");
        }
        $conn = self::$em->getConnection();
        $at = fn (string $when) => (new \DateTimeImmutable($when, new \DateTimeZone('UTC')))->format('Y-m-d H:i:s');
        $conn->executeStatement('UPDATE club_invitation SET expires_at = ? WHERE id = ?', [$at('-10 days'), $ids['expired-recent']]);
        $conn->executeStatement('UPDATE club_invitation SET expires_at = ? WHERE id = ?', [$at('-31 days'), $ids['expired-old']]);
        $conn->executeStatement("UPDATE club_invitation SET status = 'declined', resolved_at = ? WHERE id = ?", [$at('-31 days'), $ids['declined-old']]);
        $conn->executeStatement("UPDATE club_invitation SET status = 'declined', resolved_at = ? WHERE id = ?", [$at('-2 days'), $ids['declined-recent']]);
        $conn->executeStatement("UPDATE club_invitation SET status = 'accepted', resolved_at = ? WHERE id = ?", [$at('-40 days'), $ids['accepted-old']]);

        $application = new Application(self::$kernel ?? static::bootKernel());
        $tester = new CommandTester($application->find('app:prune-club-invitations'));
        $this->assertSame(0, $tester->execute([]));
        $this->assertStringContainsString('Deleted 3 old club invitation', $tester->getDisplay());

        self::$em->clear();
        $left = array_map(fn (ClubInvitation $i) => $i->getEmail(), self::$em->getRepository(ClubInvitation::class)->findAll());
        sort($left);
        $this->assertSame(['declined-recent@example.com', 'expired-recent@example.com', 'fresh@example.com'], $left);
    }
}
