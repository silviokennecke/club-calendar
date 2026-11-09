<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\FeedMember;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Service\MemberSubscriptionService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Personal subscription ("Mein Abo"): lazy creation, selection, secret rotation, cleanup, claim hook. */
class MemberSubscriptionTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private Club $club;
    private Calendar $calendar;
    private string $base;

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
        $this->admin = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $this->club = TestHelper::createClub(self::$em, $this->admin);
        $this->calendar = TestHelper::createCalendar(self::$em, $this->club);
        $this->base = '/api/clubs/'.$this->club->getId();
    }

    private function req(?User $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, $who ? TestHelper::authHeader($who, self::$tokens) : '');
    }

    private function user(string $email, ?ClubRole $role = null): User
    {
        $user = TestHelper::createUser(self::$em, self::$hasher, $email);
        if (null !== $role) {
            TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $user, $role);
        }

        return $user;
    }

    private function feed(FeedVisibility $visibility, string $name = 'Feed'): CalendarFeed
    {
        return TestHelper::createFeed(self::$em, self::$em->find(Club::class, $this->club->getId()), [self::$em->find(Calendar::class, $this->calendar->getId())], $visibility, $name);
    }

    private function rows(string $table): int
    {
        return (int) self::$em->getConnection()->fetchOne("SELECT COUNT(*) FROM $table");
    }

    /** @return iterable<string, array{string}> */
    public static function memberRoles(): iterable
    {
        foreach (['member', 'viewer', 'editor', 'admin'] as $role) {
            yield $role => [$role];
        }
    }

    #[DataProvider('memberRoles')]
    public function testEveryRoleGetsItsOwnLazilyCreatedSubscription(string $role): void
    {
        $user = $this->user("r-$role@example.com", ClubRole::from($role));
        $r = $this->req($user, 'GET', $this->base.'/my-subscription');
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertEqualsCanonicalizing(['id', 'secret', 'selectedFeedIds', 'targetGroupIds', 'updatedAt'], array_keys($r['body']));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $r['body']['secret']);
        $this->assertSame([], $r['body']['selectedFeedIds']);
        $this->assertSame([], $r['body']['targetGroupIds']);

        $again = $this->req($user, 'GET', $this->base.'/my-subscription');
        $this->assertSame($r['body'], $again['body']);
        $this->assertSame(1, $this->rows('member_subscription'));
    }

    public function testAuthAndMembership(): void
    {
        foreach ([['GET', '/my-subscription'], ['PUT', '/my-subscription'], ['POST', '/my-subscription/rotate-secret'], ['GET', '/my-feeds']] as [$m, $p]) {
            $this->assertSame(401, $this->req(null, $m, $this->base.$p)['status'], "$m $p");
            $outsider = $this->user('outsider-'.md5($m.$p).'@example.com');
            $this->assertSame(403, $this->req($outsider, $m, $this->base.$p, ['feedIds' => [], 'targetGroupIds' => []])['status'], "$m $p");
        }
        $this->assertSame(0, $this->rows('member_subscription'));
    }

    public function testSubscriptionsAreSeparatePerUserAndClub(): void
    {
        $a = $this->user('a@example.com', ClubRole::MEMBER);
        $b = $this->user('b@example.com', ClubRole::MEMBER);
        $sa = $this->req($a, 'GET', $this->base.'/my-subscription')['body'];
        $sb = $this->req($b, 'GET', $this->base.'/my-subscription')['body'];
        $this->assertNotSame($sa['secret'], $sb['secret']);
        $this->assertNotSame($sa['id'], $sb['id']);

        $other = TestHelper::createClub(self::$em, self::$em->find(User::class, $a->getId()), 'Other');
        $so = $this->req($a, 'GET', '/api/clubs/'.$other->getId().'/my-subscription')['body'];
        $this->assertNotSame($sa['id'], $so['id']);
        $this->assertSame(3, $this->rows('member_subscription'));
    }

    public function testConcurrentCreationYieldsOneRow(): void
    {
        $user = $this->user('m@example.com', ClubRole::MEMBER);
        $service = static::getContainer()->get(MemberSubscriptionService::class);
        $club = self::$em->find(Club::class, $this->club->getId());
        $u = self::$em->find(User::class, $user->getId());
        // a second creation attempt (as a lost race) must not fail nor add a row
        $first = $service->get($u, $club);
        $conn = self::$em->getConnection();
        $n = $conn->executeStatement('INSERT IGNORE INTO member_subscription (id, club_id, user_id, secret, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())', ['00000000-0000-7000-8000-000000000001', $club->getId(), $u->getId(), 'x']);
        $this->assertSame(0, $n);
        $this->assertSame($first['id'], $service->get($u, $club)['id']);
        $this->assertSame(1, $this->rows('member_subscription'));
    }

    public function testPutReplacesSelectionAndStampsUpdatedAt(): void
    {
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $f1 = $this->feed(FeedVisibility::CLUB, 'One');
        $f2 = $this->feed(FeedVisibility::PUBLIC, 'Two');
        $tg = TestHelper::createTargetGroup(self::$em, self::$em->find(Club::class, $this->club->getId()), 'Youth');

        $before = $this->req($member, 'GET', $this->base.'/my-subscription')['body'];
        sleep(1);
        $r = $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$f1->getId(), $f2->getId()], 'targetGroupIds' => [$tg->getId()]]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertEqualsCanonicalizing([$f1->getId(), $f2->getId()], $r['body']['selectedFeedIds']);
        $this->assertSame([$tg->getId()], $r['body']['targetGroupIds']);
        $this->assertSame($before['secret'], $r['body']['secret']);
        $this->assertGreaterThan(strtotime($before['updatedAt']), strtotime($r['body']['updatedAt']));

        $r = $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$f2->getId()], 'targetGroupIds' => []]);
        $this->assertSame([$f2->getId()], $r['body']['selectedFeedIds']);
        $this->assertSame([], $r['body']['targetGroupIds']);
        $this->assertSame(1, $this->rows('member_subscription_feed'));
        $this->assertSame(0, $this->rows('member_subscription_target_group'));

        // idempotent
        $r2 = $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$f2->getId()], 'targetGroupIds' => []]);
        $this->assertSame($r['body'], $r2['body']);
    }

    public function testPutValidation(): void
    {
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $private = $this->feed(FeedVisibility::PRIVATE, 'Secret');
        $otherClub = TestHelper::createClub(self::$em, self::$em->find(User::class, $this->admin->getId()), 'Other');
        $foreignGroup = TestHelper::createTargetGroup(self::$em, $otherClub, 'Foreign');

        $r = $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$private->getId()], 'targetGroupIds' => []]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('unknown_reference', $r['body']['code']);
        $this->assertSame('feedIds', $r['body']['field']);

        $r = $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => ['00000000-0000-7000-8000-000000000000'], 'targetGroupIds' => []]);
        $this->assertSame('unknown_reference', $r['body']['code']);

        $r = $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [], 'targetGroupIds' => [$foreignGroup->getId()]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('targetGroupIds', $r['body']['field']);

        $this->assertSame(400, $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => []])['status']);
        $this->assertSame(400, $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => 'x', 'targetGroupIds' => []])['status']);
        $tooMany = array_map(fn (int $i) => sprintf('00000000-0000-7000-8000-%012d', $i), range(1, 501));
        $this->assertSame(400, $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => $tooMany, 'targetGroupIds' => []])['status']);
        $this->assertSame(400, $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [], 'targetGroupIds' => $tooMany])['status']);
        $this->assertSame(0, $this->rows('member_subscription_feed'));
    }

    public function testPrivateFeedAssignedVersusNotAndStaff(): void
    {
        $private = $this->feed(FeedVisibility::PRIVATE, 'Secret');
        $assigned = $this->user('assigned@example.com', ClubRole::MEMBER);
        $plain = $this->user('plain@example.com', ClubRole::MEMBER);
        $viewer = $this->user('viewer@example.com', ClubRole::VIEWER);
        self::$em->persist(new FeedMember(self::$em->find(CalendarFeed::class, $private->getId()), self::$em->find(User::class, $assigned->getId()), FeedMember::ASSIGNED, null));
        self::$em->flush();

        $body = ['feedIds' => [$private->getId()], 'targetGroupIds' => []];
        $this->assertSame(200, $this->req($assigned, 'PUT', $this->base.'/my-subscription', $body)['status']);
        $this->assertSame(422, $this->req($plain, 'PUT', $this->base.'/my-subscription', $body)['status']);
        $this->assertSame(200, $this->req($viewer, 'PUT', $this->base.'/my-subscription', $body)['status']);
        $this->assertSame(200, $this->req($this->admin, 'PUT', $this->base.'/my-subscription', $body)['status']);
    }

    public function testStaleSelectionIsIgnoredAndRemovedOnNextPut(): void
    {
        $private = $this->feed(FeedVisibility::PRIVATE, 'Secret');
        $open = $this->feed(FeedVisibility::CLUB, 'Open');
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $fm = new FeedMember(self::$em->find(CalendarFeed::class, $private->getId()), self::$em->find(User::class, $member->getId()), FeedMember::ASSIGNED, null);
        self::$em->persist($fm);
        self::$em->flush();
        $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$private->getId(), $open->getId()], 'targetGroupIds' => []]);

        // access revoked: the feed disappears from the selection without an error
        self::$em->getConnection()->executeStatement('DELETE FROM feed_member');
        $r = $this->req($member, 'GET', $this->base.'/my-subscription');
        $this->assertSame(200, $r['status']);
        $this->assertSame([$open->getId()], $r['body']['selectedFeedIds']);
        $this->assertSame(2, $this->rows('member_subscription_feed'));

        $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$open->getId()], 'targetGroupIds' => []]);
        $this->assertSame(1, $this->rows('member_subscription_feed'));

        // archived-only feeds are not selectable and are ignored when read
        self::$em->getConnection()->executeStatement('UPDATE calendar SET archived_at = NOW()');
        $this->assertSame([], $this->req($member, 'GET', $this->base.'/my-subscription')['body']['selectedFeedIds']);
        $this->assertSame([], $this->req($member, 'GET', $this->base.'/my-feeds')['body']['feeds']);
        $this->assertSame(422, $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$open->getId()], 'targetGroupIds' => []])['status']);
    }

    public function testMyFeedsListsOnlyAccessibleFeedsWithoutSecrets(): void
    {
        $pub = $this->feed(FeedVisibility::PUBLIC, 'Pub');
        $club = $this->feed(FeedVisibility::CLUB, 'Club');
        $assignedFeed = $this->feed(FeedVisibility::PRIVATE, 'Assigned');
        $claimedFeed = $this->feed(FeedVisibility::PRIVATE, 'Claimed');
        $hidden = $this->feed(FeedVisibility::PRIVATE, 'Hidden');
        $tg = TestHelper::createTargetGroup(self::$em, self::$em->find(Club::class, $this->club->getId()), 'Youth');
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $mu = self::$em->find(User::class, $member->getId());
        self::$em->persist(new FeedMember(self::$em->find(CalendarFeed::class, $assignedFeed->getId()), $mu, FeedMember::ASSIGNED, null));
        self::$em->persist(new FeedMember(self::$em->find(CalendarFeed::class, $claimedFeed->getId()), $mu, FeedMember::CLAIMED, $mu));
        self::$em->flush();
        $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$club->getId()], 'targetGroupIds' => []]);

        $r = $this->req($member, 'GET', $this->base.'/my-feeds');
        $this->assertSame(200, $r['status'], $r['content']);
        $byId = array_column($r['body']['feeds'], null, 'id');
        $this->assertEqualsCanonicalizing([$pub->getId(), $club->getId(), $assignedFeed->getId(), $claimedFeed->getId()], array_keys($byId));
        $this->assertArrayNotHasKey($hidden->getId(), $byId);
        $this->assertSame('public', $byId[$pub->getId()]['accessReason']);
        $this->assertSame('club', $byId[$club->getId()]['accessReason']);
        $this->assertSame('assigned', $byId[$assignedFeed->getId()]['accessReason']);
        $this->assertSame('claimed', $byId[$claimedFeed->getId()]['accessReason']);
        $this->assertTrue($byId[$club->getId()]['selected']);
        $this->assertFalse($byId[$pub->getId()]['selected']);
        $this->assertSame(['Test Calendar'], $byId[$pub->getId()]['calendarNames']);
        $this->assertSame([['id' => $tg->getId(), 'name' => 'Youth']], $r['body']['targetGroups']);
        foreach ($r['body']['feeds'] as $f) {
            $this->assertEqualsCanonicalizing(['id', 'name', 'visibility', 'calendarNames', 'accessReason', 'selected'], array_keys($f));
        }
        $this->assertStringNotContainsString('sharedSecret', $r['content']);
        $secrets = self::$em->getConnection()->fetchFirstColumn('SELECT shared_secret FROM calendar_feed');
        foreach ($secrets as $secret) {
            $this->assertStringNotContainsString($secret, $r['content']);
        }

        // staff see all feeds, reason staff for PRIVATE ones
        $r = $this->req($this->admin, 'GET', $this->base.'/my-feeds');
        $byId = array_column($r['body']['feeds'], null, 'id');
        $this->assertCount(5, $byId);
        $this->assertSame('staff', $byId[$hidden->getId()]['accessReason']);
    }

    public function testMyFeedsQueryCountDoesNotGrowWithFeeds(): void
    {
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $measure = function () use ($member): int {
            $before = QueryCounter::$count;
            $this->assertSame(200, $this->req($member, 'GET', $this->base.'/my-feeds')['status']);

            return QueryCounter::$count - $before;
        };
        $this->feed(FeedVisibility::CLUB, 'A');
        $few = $measure();
        for ($i = 0; $i < 6; ++$i) {
            $this->feed(0 === $i % 2 ? FeedVisibility::PRIVATE : FeedVisibility::PUBLIC, 'F'.$i);
        }
        $this->assertSame($few, $measure());
    }

    public function testMyFeedsDoesNotCreateASubscription(): void
    {
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $this->assertSame(200, $this->req($member, 'GET', $this->base.'/my-feeds')['status']);
        $this->assertSame(0, $this->rows('member_subscription'));
    }

    public function testRotateSecretKillsTheOldOneAndIsRateLimited(): void
    {
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $old = $this->req($member, 'GET', $this->base.'/my-subscription')['body'];
        $r = $this->req($member, 'POST', $this->base.'/my-subscription/rotate-secret');
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertNotSame($old['secret'], $r['body']['secret']);
        $this->assertSame($old['id'], $r['body']['id']);
        $this->assertSame($r['body']['secret'], $this->req($member, 'GET', $this->base.'/my-subscription')['body']['secret']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM member_subscription WHERE secret = ?', [$old['secret']]));

        for ($i = 0; $i < 9; ++$i) {
            $this->assertSame(200, $this->req($member, 'POST', $this->base.'/my-subscription/rotate-secret')['status']);
        }
        $r = $this->req($member, 'POST', $this->base.'/my-subscription/rotate-secret');
        $this->assertSame(429, $r['status']);
        $this->assertSame('rate_limited', $r['body']['code']);
    }

    public function testLeavingAndRemovalDeleteTheSubscriptionButDemotionKeepsIt(): void
    {
        $feed = $this->feed(FeedVisibility::CLUB);
        $leaver = $this->user('leaver@example.com', ClubRole::MEMBER);
        $removed = $this->user('removed@example.com', ClubRole::EDITOR);
        $demoted = $this->user('demoted@example.com', ClubRole::EDITOR);
        foreach ([$leaver, $removed, $demoted] as $u) {
            $this->req($u, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$feed->getId()], 'targetGroupIds' => []]);
        }
        $this->assertSame(3, $this->rows('member_subscription'));

        $this->assertSame(200, $this->req($this->admin, 'PATCH', $this->base.'/members/'.$demoted->getId(), ['role' => 'member'])['status']);
        $this->assertSame(3, $this->rows('member_subscription'));

        $this->assertSame(200, $this->req($leaver, 'DELETE', $this->base.'/members/'.$leaver->getId())['status']);
        $this->assertSame(200, $this->req($this->admin, 'DELETE', $this->base.'/members/'.$removed->getId())['status']);
        $this->assertSame(1, $this->rows('member_subscription'));
        $this->assertSame(1, $this->rows('member_subscription_feed'));

        // a former member gets 403 and rejoining starts with a fresh subscription
        $this->assertSame(403, $this->req($leaver, 'GET', $this->base.'/my-subscription')['status']);
    }

    public function testAccountDeletionCascades(): void
    {
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $feed = $this->feed(FeedVisibility::CLUB);
        $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$feed->getId()], 'targetGroupIds' => []]);
        self::$em->getConnection()->executeStatement('DELETE FROM user WHERE id = ?', [$member->getId()]);
        $this->assertSame(0, $this->rows('member_subscription'));
        $this->assertSame(0, $this->rows('member_subscription_feed'));
    }

    public function testClaimAddsFeedToNewAndExistingSubscription(): void
    {
        $private = $this->feed(FeedVisibility::PRIVATE, 'Secret');
        $other = $this->feed(FeedVisibility::PRIVATE, 'Other');
        $secret = self::$em->find(CalendarFeed::class, $private->getId())->getSharedSecret();
        $otherSecret = self::$em->find(CalendarFeed::class, $other->getId())->getSharedSecret();

        // newcomer joins through the feed: new subscription with the feed and all groups
        $newcomer = $this->user('new@example.com');
        $r = $this->req($newcomer, 'POST', "/api/feed/{$private->getId()}/claim", ['secret' => $secret]);
        $this->assertSame(200, $r['status'], $r['content']);
        $sub = $this->req($newcomer, 'GET', $this->base.'/my-subscription')['body'];
        $this->assertSame([$private->getId()], $sub['selectedFeedIds']);
        $this->assertSame([], $sub['targetGroupIds']);
        $this->assertSame(1, $this->rows('member_subscription'));

        // existing member with a lazily created (empty) subscription gets the claimed feed added
        $member = $this->user('m@example.com', ClubRole::MEMBER);
        $this->assertSame([], $this->req($member, 'GET', $this->base.'/my-subscription')['body']['selectedFeedIds']);
        $this->assertSame(200, $this->req($member, 'POST', "/api/feed/{$other->getId()}/claim", ['secret' => $otherSecret])['status']);
        $this->assertSame(200, $this->req($member, 'POST', "/api/feed/{$other->getId()}/claim", ['secret' => $otherSecret])['status']);
        $sub = $this->req($member, 'GET', $this->base.'/my-subscription')['body'];
        $this->assertSame([$other->getId()], $sub['selectedFeedIds']);

        // an existing member without a subscription yet: created by the claim with that feed
        $third = $this->user('third@example.com', ClubRole::MEMBER);
        $this->assertSame(200, $this->req($third, 'POST', "/api/feed/{$private->getId()}/claim", ['secret' => $secret])['status']);
        $this->assertSame([$private->getId()], $this->req($third, 'GET', $this->base.'/my-subscription')['body']['selectedFeedIds']);
    }

    public function testSelectionChangeDoesNotLeakIntoOtherUsers(): void
    {
        $feed = $this->feed(FeedVisibility::CLUB);
        $a = $this->user('a@example.com', ClubRole::MEMBER);
        $b = $this->user('b@example.com', ClubRole::MEMBER);
        $this->req($a, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$feed->getId()], 'targetGroupIds' => []]);
        $this->assertSame([], $this->req($b, 'GET', $this->base.'/my-subscription')['body']['selectedFeedIds']);
    }
}
