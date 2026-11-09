<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\FeedMember;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedSignup;
use App\Enum\FeedVisibility;
use App\Service\FeedAccessPolicy;
use App\Service\Quota;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Exception\UniqueConstraintViolationException;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Club self-join through feeds (`feedSignup`, claim, membership) and the staff-managed feed access. */
class FeedSignupTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private Club $club;
    private Calendar $calendar;

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
        $this->admin = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $this->club = TestHelper::createClub(self::$em, $this->admin);
        $this->calendar = TestHelper::createCalendar(self::$em, $this->club);
    }

    private function req(?User $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, $who ? TestHelper::authHeader($who, self::$tokens) : '');
    }

    private function user(string $email, ?ClubRole $role = null, bool $verified = true): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email, 'password123', $verified);
        if (null !== $role) {
            TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $user, $role);
        }

        return $user;
    }

    private function feed(FeedVisibility $visibility, ?string $secret = null): CalendarFeed
    {
        $secret ??= FeedVisibility::PRIVATE === $visibility ? 'secret-abc' : 'secret-'.uniqid();

        return TestHelper::createFeed(self::$em, $this->club, [$this->calendar], $visibility, 'Feed '.$visibility->value, $secret);
    }

    private function setSignup(FeedSignup $signup): void
    {
        $club = self::$em->find(Club::class, $this->club->getId());
        $club->setFeedSignup($signup);
        self::$em->flush();
    }

    private function role(User $user): ?ClubRole
    {
        $role = self::$em->getConnection()->fetchOne('SELECT role FROM club_user WHERE club_id = ? AND user_id = ?', [$this->club->getId(), $user->getId()]);

        return false === $role ? null : ClubRole::from($role);
    }

    /** Source of the stored feed access, null when there is none. */
    private function feedMemberRow(CalendarFeed $feed, User $user): ?string
    {
        $source = self::$em->getConnection()->fetchOne('SELECT source FROM feed_member WHERE feed_id = ? AND user_id = ?', [$feed->getId(), $user->getId()]);

        return false === $source ? null : $source;
    }

    // ---- setting

    public function testSettingDefaultsToInternalAndIsAdminEditable(): void
    {
        $base = '/api/clubs/'.$this->club->getId();
        $this->assertSame('internal', $this->req($this->admin, 'GET', $base)['body']['feedSignup']);
        $this->assertSame('internal', $this->req($this->admin, 'GET', '/api/clubs')['body'][0]['feedSignup']);

        $r = $this->req($this->admin, 'PATCH', $base, ['feedSignup' => 'public']);
        $this->assertSame(200, $r['status']);
        $this->assertSame('public', $r['body']['feedSignup']);
        $this->assertSame('public', $this->req($this->admin, 'GET', $base)['body']['feedSignup']);

        $r = $this->req($this->admin, 'PATCH', $base, ['feedSignup' => 'bogus']);
        $this->assertSame(400, $r['status']);
        $this->assertSame('feedSignup', $r['body']['field']);
        $this->assertSame(400, $this->req($this->admin, 'PATCH', $base, ['feedSignup' => true])['status']);

        $editor = $this->user('editor@example.com', ClubRole::EDITOR);
        $this->assertSame(403, $this->req($editor, 'PATCH', $base, ['feedSignup' => 'off'])['status']);
        $member = $this->user('member@example.com', ClubRole::MEMBER);
        $this->assertArrayNotHasKey('feedSignup', $this->req($member, 'GET', $base)['body']);
        $this->assertArrayNotHasKey('feedSignup', $this->req($member, 'GET', '/api/clubs')['body'][0]);
    }

    // ---- claim

    /** @return iterable<string, array{string, string, bool}> */
    public static function matrix(): iterable
    {
        foreach (['off' => [false, false, false], 'internal' => [true, true, false], 'public' => [true, true, true]] as $setting => [$club, $private, $public]) {
            yield "$setting/CLUB" => [$setting, 'CLUB', $club];
            yield "$setting/PRIVATE" => [$setting, 'PRIVATE', $private];
            yield "$setting/PUBLIC" => [$setting, 'PUBLIC', $public];
        }
    }

    #[DataProvider('matrix')]
    public function testNewUserJoinsOnlyWhenTheSettingAllowsTheVisibility(string $setting, string $visibility, bool $allowed): void
    {
        $this->setSignup(FeedSignup::from($setting));
        $feed = $this->feed(FeedVisibility::from($visibility));
        $newcomer = $this->user('new@example.com');

        $m = $this->req($newcomer, 'GET', "/api/feed/{$feed->getId()}/membership?secret=secret-abc");
        $this->assertSame(200, $m['status']);
        $this->assertSame($allowed, $m['body']['canJoin']);
        $this->assertFalse($m['body']['isClubMember']);

        $r = $this->req($newcomer, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        if (!$allowed) {
            $this->assertSame(403, $r['status']);
            $this->assertSame('member_signup_disabled', $r['body']['code']);
            $this->assertNull($this->role($newcomer));

            return;
        }
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['clubId' => $this->club->getId(), 'clubName' => 'Test Club', 'feedId' => $feed->getId(), 'joined' => true], $r['body']);
        $this->assertSame(ClubRole::MEMBER, $this->role($newcomer));
        $row = $this->feedMemberRow($feed, $newcomer);
        if ('PRIVATE' === $visibility) {
            $this->assertSame('claimed', $row);
        } else {
            $this->assertNull($row);
        }
    }

    public function testExistingMemberMayAlwaysClaimEvenWhenSignupIsOff(): void
    {
        $this->setSignup(FeedSignup::OFF);
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $member = $this->user('member@example.com', ClubRole::MEMBER);

        $m = $this->req($member, 'GET', "/api/feed/{$feed->getId()}/membership?secret=secret-abc");
        $this->assertSame(['clubName' => 'Test Club', 'isClubMember' => true, 'hasFeedAccess' => false, 'canJoin' => false, 'canClaim' => true], $m['body']);

        $r = $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $this->assertSame(200, $r['status']);
        $this->assertFalse($r['body']['joined']);
        $this->assertSame('claimed', $this->feedMemberRow($feed, $member));

        // idempotent
        $this->assertSame(200, $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc'])['status']);
        $this->assertSame(1, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM feed_member'));
        $m = $this->req($member, 'GET', "/api/feed/{$feed->getId()}/membership?secret=secret-abc");
        $this->assertTrue($m['body']['hasFeedAccess']);
        $this->assertFalse($m['body']['canClaim']);
    }

    public function testStaffNeedNoRowAndAssignedIsNotDowngraded(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $viewer = $this->user('viewer@example.com', ClubRole::VIEWER);
        $this->assertSame(200, $this->req($viewer, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc'])['status']);
        $this->assertNull($this->feedMemberRow($feed, $viewer));

        $member = $this->user('member@example.com', ClubRole::MEMBER);
        self::$em->persist(new FeedMember(self::$em->find(CalendarFeed::class, $feed->getId()), self::$em->find(User::class, $member->getId()), FeedMember::ASSIGNED, null));
        self::$em->flush();
        $this->assertSame(200, $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc'])['status']);
        $this->assertSame('assigned', $this->feedMemberRow($feed, $member));
    }

    public function testLookupFailuresAreOneIndistinguishable404(): void
    {
        $private = $this->feed(FeedVisibility::PRIVATE);
        $archivedCal = TestHelper::createCalendar(self::$em, $this->club, 'Old');
        $archivedFeed = TestHelper::createFeed(self::$em, $this->club, [$archivedCal], FeedVisibility::CLUB);
        self::$em->find(Calendar::class, $archivedCal->getId())->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $user = $this->user('new@example.com');

        $bodies = [];
        foreach ([
            "/api/feed/{$private->getId()}/claim" => ['secret' => 'wrong'],
            "/api/feed/{$private->getId()}/claim" => [],
            '/api/feed/00000000-0000-7000-8000-000000000000/claim' => ['secret' => 'secret-abc'],
            "/api/feed/{$archivedFeed->getId()}/claim" => [],
        ] as $uri => $body) {
            $r = $this->req($user, 'POST', $uri, $body);
            $this->assertSame(404, $r['status'], $uri);
            $this->assertSame('feed_not_found', $r['body']['code']);
            $bodies[] = $r['body']['detail'];
        }
        $this->assertCount(1, array_unique($bodies));
        $this->assertNull($this->role($user));

        foreach (["/api/feed/{$private->getId()}/membership", "/api/feed/{$private->getId()}/membership?secret=wrong", '/api/feed/00000000-0000-7000-8000-000000000000/membership'] as $uri) {
            $r = $this->req($user, 'GET', $uri);
            $this->assertSame(404, $r['status']);
            $this->assertSame('feed_not_found', $r['body']['code']);
        }
        $this->assertSame(400, $this->req($user, 'POST', "/api/feed/{$private->getId()}/claim", ['secret' => ['x']])['status']);
    }

    public function testClaimIsNotPublicAndNeedsAVerifiedAddress(): void
    {
        $feed = $this->feed(FeedVisibility::CLUB);
        $r = $this->req(null, 'POST', "/api/feed/{$feed->getId()}/claim");
        $this->assertSame(401, $r['status']);
        $this->assertSame(401, $this->req(null, 'GET', "/api/feed/{$feed->getId()}/membership")['status']);

        $unverified = $this->user('unverified@example.com', null, false);
        $r = $this->req($unverified, 'POST', "/api/feed/{$feed->getId()}/claim");
        $this->assertSame(403, $r['status']);
        $this->assertSame('email_verification_required', $r['body']['code']);
        $this->assertNull($this->role($unverified));

        // the other feed routes stay public
        $this->assertSame(200, $this->req(null, 'GET', "/api/feed/{$feed->getId()}/events")['status']);
    }

    public function testMemberQuotaBlocksNewMembership(): void
    {
        $feed = $this->feed(FeedVisibility::CLUB);
        $conn = self::$em->getConnection();
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=0');
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        for ($i = 1; $i < Quota::LIMITS[Quota::MEMBERS_PER_CLUB]; ++$i) {
            $conn->insert('club_user', ['club_id' => $this->club->getId(), 'user_id' => sprintf('00000000-0000-7000-8000-%012d', $i), 'role' => 'member', 'updated_at' => $now]);
        }
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=1');
        $user = $this->user('late@example.com');
        $r = $this->req($user, 'POST', "/api/feed/{$feed->getId()}/claim");
        $this->assertSame(422, $r['status']);
        $this->assertSame('quota_exceeded', $r['body']['code']);
        $this->assertSame(Quota::MEMBERS_PER_CLUB, $r['body']['resource']);
        $this->assertNull($this->role($user));
    }

    public function testFeedMemberIsUniquePerFeedAndUser(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $user = $this->user('m@example.com', ClubRole::MEMBER);
        $feed = self::$em->find(CalendarFeed::class, $feed->getId());
        $user = self::$em->find(User::class, $user->getId());
        self::$em->persist(new FeedMember($feed, $user, FeedMember::CLAIMED, null));
        self::$em->flush();
        $this->expectException(UniqueConstraintViolationException::class);
        self::$em->persist(new FeedMember($feed, $user, FeedMember::ASSIGNED, null));
        self::$em->flush();
    }

    public function testFeedMemberChangesStampTheFeed(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $before = self::$em->getConnection()->fetchOne('SELECT updated_at FROM calendar_feed WHERE id = ?', [$feed->getId()]);
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        sleep(1);
        $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $after = self::$em->getConnection()->fetchOne('SELECT updated_at FROM calendar_feed WHERE id = ?', [$feed->getId()]);
        $this->assertGreaterThan($before, $after);
    }

    // ---- access policy

    public function testAccessPolicyBatchesAccessibleFeeds(): void
    {
        $public = $this->feed(FeedVisibility::PUBLIC);
        $club = $this->feed(FeedVisibility::CLUB);
        $privA = $this->feed(FeedVisibility::PRIVATE, 'a-secret');
        $privB = $this->feed(FeedVisibility::PRIVATE, 'b-secret');
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $viewer = $this->user('v@example.com', ClubRole::VIEWER);
        $outsider = $this->user('o@example.com');
        self::$em->persist(new FeedMember(self::$em->find(CalendarFeed::class, $privA->getId()), self::$em->find(User::class, $member->getId()), FeedMember::ASSIGNED, null));
        self::$em->flush();
        self::$em->clear();

        $policy = static::getContainer()->get(FeedAccessPolicy::class);
        $club0 = self::$em->find(Club::class, $this->club->getId());
        $ids = fn (User $u) => array_map(fn (CalendarFeed $f) => $f->getId(), $policy->accessibleFeeds(self::$em->find(User::class, $u->getId()), $club0));

        $this->assertEqualsCanonicalizing([$public->getId(), $club->getId(), $privA->getId()], $ids($member));
        $this->assertEqualsCanonicalizing([$public->getId(), $club->getId(), $privA->getId(), $privB->getId()], $ids($viewer));
        $this->assertSame([], $ids($outsider));
        $this->assertTrue($policy->canAccess(self::$em->find(User::class, $member->getId()), self::$em->find(CalendarFeed::class, $privA->getId())));
        $this->assertFalse($policy->canAccess(self::$em->find(User::class, $member->getId()), self::$em->find(CalendarFeed::class, $privB->getId())));
        $this->assertFalse($policy->canAccess(self::$em->find(User::class, $outsider->getId()), self::$em->find(CalendarFeed::class, $club->getId())));
    }

    // ---- assignment management

    private function membersUri(CalendarFeed $feed, string $suffix = ''): string
    {
        return "/api/clubs/{$this->club->getId()}/feeds/{$feed->getId()}/members{$suffix}";
    }

    public function testOnlyEditorsAndAdminsManageAssignments(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $viewer = $this->user('v@example.com', ClubRole::VIEWER);
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $editor = $this->user('e@example.com', ClubRole::EDITOR);
        foreach ([$viewer, $member] as $who) {
            $this->assertSame(403, $this->req($who, 'GET', $this->membersUri($feed))['status']);
            $this->assertSame(403, $this->req($who, 'POST', $this->membersUri($feed), ['userIds' => []])['status']);
            $this->assertSame(403, $this->req($who, 'POST', $this->membersUri($feed, '/by-email'), ['emails' => []])['status']);
            $this->assertSame(403, $this->req($who, 'POST', $this->membersUri($feed, '/bulk-delete'), ['userIds' => []])['status']);
            $this->assertSame(403, $this->req($who, 'DELETE', $this->membersUri($feed, '/'.$member->getId()))['status']);
        }
        $this->assertSame(200, $this->req($editor, 'GET', $this->membersUri($feed))['status']);
        $this->assertSame(200, $this->req($editor, 'POST', $this->membersUri($feed), ['userIds' => [$member->getId()]])['status']);
    }

    public function testAssignListSearchAndRemove(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $people = [];
        foreach (['anna', 'bert', 'carl'] as $name) {
            $u = $this->user("$name@example.com", ClubRole::MEMBER);
            self::$em->find(User::class, $u->getId())->setName(ucfirst($name));
            $people[$name] = $u;
        }
        self::$em->flush();

        $r = $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => [$people['anna']->getId(), $people['bert']->getId(), $people['anna']->getId()]]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(2, $r['body']['added']);
        $this->assertSame(0, $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => [$people['anna']->getId()]])['body']['added']);

        $r = $this->req($this->admin, 'GET', $this->membersUri($feed).'?perPage=1&page=2');
        $this->assertSame('2', $r['headers']['x-total-count'][0]);
        $this->assertCount(1, $r['body']);
        $this->assertSame('Bert', $r['body'][0]['name']);
        $this->assertSame('assigned', $r['body'][0]['source']);
        $this->assertSame('bert@example.com', $r['body'][0]['email']);

        $r = $this->req($this->admin, 'GET', $this->membersUri($feed).'?q=ANN');
        $this->assertSame('1', $r['headers']['x-total-count'][0]);
        $this->assertSame($people['anna']->getId(), $r['body'][0]['userId']);
        $this->assertSame('0', $this->req($this->admin, 'GET', $this->membersUri($feed).'?source=claimed')['headers']['x-total-count'][0]);
        $this->assertSame(400, $this->req($this->admin, 'GET', $this->membersUri($feed).'?source=x')['status']);
        $this->assertSame(400, $this->req($this->admin, 'GET', $this->membersUri($feed).'?perPage=101')['status']);

        $this->assertSame(200, $this->req($this->admin, 'DELETE', $this->membersUri($feed, '/'.$people['anna']->getId()))['status']);
        $this->assertSame(200, $this->req($this->admin, 'DELETE', $this->membersUri($feed, '/'.$people['anna']->getId()))['status']);
        $r = $this->req($this->admin, 'POST', $this->membersUri($feed, '/bulk-delete'), ['userIds' => [$people['bert']->getId(), $people['carl']->getId()]]);
        $this->assertSame(['removed' => 1], $r['body']);
        $this->assertSame('0', $this->req($this->admin, 'GET', $this->membersUri($feed))['headers']['x-total-count'][0]);
    }

    public function testAssignValidation(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $outsider = $this->user('o@example.com');
        $member = $this->user('m@example.com', ClubRole::MEMBER);

        $r = $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => [$member->getId(), $outsider->getId()]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('unknown_reference', $r['body']['code']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM feed_member'));

        $r = $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => array_map(fn ($i) => sprintf('00000000-0000-7000-8000-%012d', $i), range(1, 501))]);
        $this->assertSame(400, $r['status']);

        $club = $this->feed(FeedVisibility::CLUB);
        $r = $this->req($this->admin, 'POST', $this->membersUri($club), ['userIds' => [$member->getId()]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('invalid_request', $r['body']['code']);
        $r = $this->req($this->admin, 'POST', $this->membersUri($club, '/by-email'), ['emails' => ['m@example.com']]);
        $this->assertSame('invalid_request', $r['body']['code']);

        $this->assertSame(404, $this->req($this->admin, 'GET', "/api/clubs/{$this->club->getId()}/feeds/00000000-0000-7000-8000-000000000000/members")['status']);
    }

    public function testAssignByEmailAddsOnlyClubMembers(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $this->user('outsider@example.com');

        $r = $this->req($this->admin, 'POST', $this->membersUri($feed, '/by-email'), ['emails' => [' M@Example.com ', 'outsider@example.com', 'nobody@example.com', 'm@example.com']]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(1, $r['body']['added']);
        $this->assertEqualsCanonicalizing(['outsider@example.com', 'nobody@example.com'], $r['body']['unknown']);
        $this->assertSame('assigned', $this->feedMemberRow($feed, $member));
        $this->assertSame(0, $this->req($this->admin, 'POST', $this->membersUri($feed, '/by-email'), ['emails' => ['m@example.com']])['body']['added']);
    }

    public function testAssigningUpgradesAClaimedAccess(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $r = $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => [$member->getId()]]);
        $this->assertSame(1, $r['body']['added']);
        $this->assertSame('assigned', $this->feedMemberRow($feed, $member));
    }

    public function testFeedMemberQuotaPerFeed(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $limit = Quota::LIMITS[Quota::FEED_MEMBERS_PER_FEED];
        $conn = self::$em->getConnection();
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=0');
        $now = (new \DateTimeImmutable())->format('Y-m-d H:i:s');
        for ($i = 1; $i <= $limit; ++$i) {
            $conn->insert('feed_member', ['id' => sprintf('00000000-0000-7000-9000-%012d', $i), 'feed_id' => $feed->getId(), 'user_id' => sprintf('00000000-0000-7000-8000-%012d', $i), 'source' => 'assigned', 'created_at' => $now]);
        }
        $conn->executeStatement('SET FOREIGN_KEY_CHECKS=1');
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $r = $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => [$member->getId()]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame(Quota::FEED_MEMBERS_PER_FEED, $r['body']['resource']);
        $r = $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $this->assertSame('quota_exceeded', $r['body']['code']);
    }

    public function testFeedListCarriesAssignedCount(): void
    {
        $a = $this->feed(FeedVisibility::PRIVATE, 'a');
        $b = $this->feed(FeedVisibility::PRIVATE, 'b');
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $this->req($this->admin, 'POST', $this->membersUri($a), ['userIds' => [$member->getId()]]);

        $list = $this->req($this->admin, 'GET', "/api/clubs/{$this->club->getId()}/feeds")['body'];
        $counts = array_column($list, 'assignedCount', 'id');
        $this->assertSame([$a->getId() => 1, $b->getId() => 0], $counts);
        $this->assertSame(1, $this->req($this->admin, 'GET', "/api/clubs/{$this->club->getId()}/feeds/{$a->getId()}")['body']['assignedCount']);
    }

    // ---- rotation and cleanup

    public function testRegenerateSecretWithAndWithoutRevokingClaimedAccess(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $claimed = $this->user('c@example.com', ClubRole::MEMBER);
        $assigned = $this->user('a@example.com', ClubRole::MEMBER);
        $this->req($claimed, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $this->req($this->admin, 'POST', $this->membersUri($feed), ['userIds' => [$assigned->getId()]]);
        $url = "/api/clubs/{$this->club->getId()}/feeds/{$feed->getId()}/regenerate-secret?includeSecret=1";

        $r = $this->req($this->admin, 'POST', $url);
        $this->assertSame(200, $r['status']);
        $this->assertNotSame('secret-abc', $r['body']['sharedSecret']);
        $this->assertNotNull($this->feedMemberRow($feed, $claimed));
        $this->assertSame(404, $this->req($this->user('late@example.com'), 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc'])['status']);

        $r = $this->req($this->admin, 'POST', $url, ['revokeClaimed' => true]);
        $this->assertSame(200, $r['status']);
        $this->assertSame(1, $r['body']['assignedCount']);
        $this->assertNull($this->feedMemberRow($feed, $claimed));
        $this->assertNotNull($this->feedMemberRow($feed, $assigned));

        $this->assertSame(400, $this->req($this->admin, 'POST', $url, ['revokeClaimed' => 'yes'])['status']);
        $editor = $this->user('e@example.com', ClubRole::EDITOR);
        $this->assertSame(403, $this->req($editor, 'POST', $url, ['revokeClaimed' => true])['status']);
    }

    public function testLeavingOrRemovalDeletesFeedAccessOfThatClub(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $other = TestHelper::createClub(self::$em, $this->admin, 'Other');
        $otherFeed = TestHelper::createFeed(self::$em, $other, [TestHelper::createCalendar(self::$em, $other)], FeedVisibility::PRIVATE);
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        TestHelper::addMember(self::$em, $other, $member, ClubRole::MEMBER);
        $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $this->req($member, 'POST', "/api/feed/{$otherFeed->getId()}/claim", ['secret' => $otherFeed->getSharedSecret()]);
        $this->assertSame(2, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM feed_member'));

        $r = $this->req($member, 'DELETE', "/api/clubs/{$this->club->getId()}/members/{$member->getId()}");
        $this->assertSame(200, $r['status']);
        $this->assertNull($this->feedMemberRow($feed, $member));
        $this->assertNotNull($this->feedMemberRow($otherFeed, $member));

        // an admin removing a person does the same
        $again = $this->user('again@example.com', ClubRole::MEMBER);
        $this->req($again, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $this->req($this->admin, 'DELETE', "/api/clubs/{$this->club->getId()}/members/{$again->getId()}");
        $this->assertNull($this->feedMemberRow($feed, $again));
    }

    public function testDeletingTheAccountOrTheFeedCascades(): void
    {
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $this->req($member, 'POST', "/api/feed/{$feed->getId()}/claim", ['secret' => 'secret-abc']);
        $this->req($this->admin, 'DELETE', "/api/clubs/{$this->club->getId()}/feeds/{$feed->getId()}");
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM feed_member'));
    }
}
