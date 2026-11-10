<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Entity\FeedMember;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Service\IcsService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\QueryCounter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Personal subscription served as ICS (secret address, ETag/304) and as calendar view (`my-events`). */
class PersonalFeedTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private TokenService $tokens;
    private string $clubId;
    private string $calA;
    private string $calB;
    private string $adminId;
    private string $memberId;
    private string $subId;
    private string $secret;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        $this->hasher = $c->get(UserPasswordHasherInterface::class);
        $this->tokens = $c->get(TokenService::class);
        DatabaseResetter::reset($this->em);
        $admin = TestHelper::createUser($this->em, $this->hasher, 'admin@example.com');
        $club = TestHelper::createClub($this->em, $admin);
        $this->clubId = $club->getId();
        $this->adminId = $admin->getId();
        $this->calA = TestHelper::createCalendar($this->em, $club, 'A')->getId();
        $this->calB = TestHelper::createCalendar($this->em, $club, 'B')->getId();
        $member = TestHelper::createUser($this->em, $this->hasher, 'member@example.com');
        TestHelper::addMember($this->em, $club, $member, ClubRole::MEMBER);
        $this->memberId = $member->getId();
    }

    private function user(string $id): User
    {
        return $this->em->find(User::class, $id);
    }

    private function club(): Club
    {
        return $this->em->find(Club::class, $this->clubId);
    }

    private function cal(string $id): Calendar
    {
        return $this->em->find(Calendar::class, $id);
    }

    private function api(?string $userId, string $method, string $uri, array $body = []): array
    {
        $auth = null === $userId ? '' : TestHelper::authHeader($this->user($userId), $this->tokens);
        $r = TestHelper::jsonRequest($this->client, $method, $uri, $body, $auth);
        $this->em->clear();

        return $r;
    }

    private function feed(FeedVisibility $v, array $cals, string $name = 'Feed'): string
    {
        return TestHelper::createFeed($this->em, $this->club(), array_map(fn (string $id) => $this->cal($id), $cals), $v, $name)->getId();
    }

    private function event(string $calId, string $name = 'E', string $in = '+10 days', bool $draft = false): string
    {
        return TestHelper::createEvent($this->em, $this->cal($calId), ['name' => $name, 'date' => (new \DateTimeImmutable($in))->format('Y-m-d'), 'isDraft' => $draft])->getId();
    }

    private function group(string $name): string
    {
        return TestHelper::createTargetGroup($this->em, $this->club(), $name)->getId();
    }

    private function assign(string $eventId, string $groupId): void
    {
        $this->em->persist((new EventTargetGroup())->setEvent($this->em->find(Event::class, $eventId))->setTargetGroup($this->em->find(TargetGroup::class, $groupId)));
        $this->em->flush();
    }

    /** Selects feeds/groups for a user (PUT) and remembers id + secret. */
    private function subscribe(string $userId, array $feedIds, array $groupIds = []): void
    {
        $r = $this->api($userId, 'PUT', "/api/clubs/{$this->clubId}/my-subscription", ['feedIds' => $feedIds, 'targetGroupIds' => $groupIds]);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->subId = $r['body']['id'];
        $this->secret = $r['body']['secret'];
    }

    /** @return array{int, ?string, \Symfony\Component\HttpFoundation\Response, string} */
    private function ics(?string $secret = null, array $headers = [], ?string $id = null): array
    {
        $this->client->request('GET', '/api/feed/me/'.($id ?? $this->subId).'/ics?secret='.rawurlencode($secret ?? $this->secret), [], [], $headers);
        $r = $this->client->getResponse();
        $body = (string) $this->client->getInternalResponse()->getContent();
        $this->em->clear();

        return [$r->getStatusCode(), $r->headers->get('ETag'), $r, $body];
    }

    private function etag(): string
    {
        [$status, $etag] = $this->ics();
        $this->assertSame(200, $status);

        return $etag;
    }

    /** @return list<string> */
    private function summaries(string $body): array
    {
        preg_match_all('/^SUMMARY:(.*)\r$/m', $body, $m);
        $s = $m[1];
        sort($s);

        return $s;
    }

    public function testUnknownIdWrongSecretAndGoneMemberAreTheSame404(): void
    {
        $feed = $this->feed(FeedVisibility::CLUB, [$this->calA]);
        $this->subscribe($this->memberId, [$feed]);

        [$s1, , $r1, $b1] = $this->ics(id: 'does-not-exist');
        [$s2, , , $b2] = $this->ics('wrong');
        [$s3, , , $b3] = $this->ics('');
        $this->client->request('GET', "/api/feed/me/{$this->subId}/ics");
        $b4 = (string) $this->client->getResponse()->getContent();
        $this->client->request('GET', "/api/feed/me/{$this->subId}/ics?secret[]=x");
        $b5 = (string) $this->client->getResponse()->getContent();
        $this->assertSame([404, 404, 404], [$s1, $s2, $s3]);
        $this->assertSame($b1, $b2);
        $this->assertSame($b1, $b3);
        $this->assertSame($b1, $b4);
        $this->assertSame($b1, $b5);
        $this->assertSame('noindex', $r1->headers->get('X-Robots-Tag'));

        // a sent matching If-None-Match never helps without the secret
        [$status] = $this->ics('wrong', ['HTTP_IF_NONE_MATCH' => '*']);
        $this->assertSame(404, $status);

        $this->assertSame(200, $this->ics()[0]);
        $this->api($this->adminId, 'DELETE', "/api/clubs/{$this->clubId}/members/{$this->memberId}");
        [$gone, , , $bg] = $this->ics();
        $this->assertSame(404, $gone);
        $this->assertSame($b1, $bg);
    }

    public function testContentIsUnionOfEffectiveFeedsDedupedPublishedWindowedAndNamed(): void
    {
        $f1 = $this->feed(FeedVisibility::CLUB, [$this->calA], 'F1');
        $f2 = $this->feed(FeedVisibility::PUBLIC, [$this->calA, $this->calB], 'F2');
        $f3 = $this->feed(FeedVisibility::CLUB, [$this->calB], 'Not selected');
        $this->event($this->calA, 'Both feeds');
        $this->event($this->calB, 'Only B');
        $this->event($this->calA, 'Draft', draft: true);
        $this->event($this->calA, 'Far future', '+4 years');
        $hc = new HolidayCalendar($this->cal($this->calA), 'Ferien', 'https://example.com/a.ics');
        $this->em->persist($hc);
        $this->em->persist(new HolidayEvent($hc, 'h1', 'Ferientag', new \DateTimeImmutable('+5 days')));
        $this->em->flush();
        $this->subscribe($this->memberId, [$f1, $f2]);

        [$status, $etag, $r, $body] = $this->ics();
        $this->assertSame(200, $status);
        $this->assertInstanceOf(StreamedResponse::class, $r);
        $this->assertFalse($r->headers->has('Content-Length'));
        $this->assertSame(['Both feeds', 'Only B'], $this->summaries($body));
        $this->assertStringNotContainsString('Ferientag', $body);
        $this->assertStringContainsString("X-WR-CALNAME:Test Club – Mein Abo\r\n", $body);
        $this->assertStringEndsWith("END:VCALENDAR\r\n", $body);
        $this->assertMatchesRegularExpression('/^"[0-9a-f]{32}"$/', $etag);
        $this->assertSame('no-cache, private', $r->headers->get('Cache-Control'));
        $this->assertSame('noindex', $r->headers->get('X-Robots-Tag'));
        $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
        $this->assertStringNotContainsString($this->secret, (string) $etag);
        unset($f3);
    }

    public function testArchivedCalendarsAndNoSelectionGiveValidEmptyCalendar(): void
    {
        $f = $this->feed(FeedVisibility::CLUB, [$this->calA]);
        $this->event($this->calA, 'x');
        $this->subscribe($this->memberId, []);
        [$status, , , $body] = $this->ics();
        $this->assertSame(200, $status);
        $this->assertStringStartsWith("BEGIN:VCALENDAR\r\n", $body);
        $this->assertStringEndsWith("END:VCALENDAR\r\n", $body);
        $this->assertStringNotContainsString('BEGIN:VEVENT', $body);

        $this->subscribe($this->memberId, [$f]);
        $this->assertCount(1, $this->summaries($this->ics()[3]));
        $this->cal($this->calA)->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();
        [$status, , , $body] = $this->ics();
        $this->assertSame(200, $status);
        $this->assertStringNotContainsString('BEGIN:VEVENT', $body);
    }

    public function testTargetGroupsOfSubscriptionAndFeedFilterTogether(): void
    {
        $kids = $this->group('Kids');
        $adults = $this->group('Adults');
        $open = $this->feed(FeedVisibility::CLUB, [$this->calA], 'Open');
        $kidsOnly = $this->feed(FeedVisibility::CLUB, [$this->calB], 'KidsOnly');
        $link = (new CalendarFeedTargetGroup())->setFeed($this->em->find(CalendarFeed::class, $kidsOnly))->setTargetGroup($this->em->find(TargetGroup::class, $kids));
        $this->em->persist($link);
        $this->em->flush();
        $a1 = $this->event($this->calA, 'A kids');
        $a2 = $this->event($this->calA, 'A adults');
        $this->event($this->calA, 'A nogroup');
        $b1 = $this->event($this->calB, 'B kids');
        $b2 = $this->event($this->calB, 'B adults');
        $this->event($this->calB, 'B nogroup');
        $this->assign($a1, $kids);
        $this->assign($a2, $adults);
        $this->assign($b1, $kids);
        $this->assign($b2, $adults);

        $this->subscribe($this->memberId, [$open, $kidsOnly]);
        $this->assertSame(['A adults', 'A kids', 'A nogroup', 'B kids'], $this->summaries($this->ics()[3]));

        $this->subscribe($this->memberId, [$open, $kidsOnly], [$kids]);
        $this->assertSame(['A kids', 'B kids'], $this->summaries($this->ics()[3]));

        $this->subscribe($this->memberId, [$open, $kidsOnly], [$adults]);
        $this->assertSame(['A adults'], $this->summaries($this->ics()[3]));

        $this->subscribe($this->memberId, [$kidsOnly], [$adults]);
        [$status, , , $body] = $this->ics();
        $this->assertSame(200, $status);
        $this->assertSame([], $this->summaries($body));
    }

    public function testEtagAnd304AndEveryChangeThatMatters(): void
    {
        $f = $this->feed(FeedVisibility::CLUB, [$this->calA], 'F');
        $g = $this->feed(FeedVisibility::CLUB, [$this->calB], 'G');
        $eventId = $this->event($this->calA, 'First');
        $tg = $this->group('Kids');
        $this->subscribe($this->memberId, [$f]);
        $base = $this->etag();
        $this->assertSame($base, $this->etag());

        foreach ([$base, 'W/'.$base, '"x", '.$base, '*'] as $inm) {
            [$status, $e, $r, $body] = $this->ics(headers: ['HTTP_IF_NONE_MATCH' => $inm]);
            $this->assertSame(304, $status, $inm);
            $this->assertSame($base, $e);
            $this->assertSame('', $body);
            $this->assertNotInstanceOf(StreamedResponse::class, $r);
            $this->assertSame('no-cache, private', $r->headers->get('Cache-Control'));
            $this->assertSame('noindex', $r->headers->get('X-Robots-Tag'));
            $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
        }

        $seen = [$base];
        $check = function (string $what) use (&$seen): void {
            $e = $this->etag();
            $this->assertNotContains($e, $seen, $what);
            $seen[] = $e;
        };

        $this->subscribe($this->memberId, [$f, $g]);
        $check('selection');
        $this->subscribe($this->memberId, [$f, $g], [$tg]);
        $check('target group selection');
        $this->subscribe($this->memberId, [$f, $g]);
        $this->assertContains($this->etag(), $seen, 'back to a former state');

        $this->em->find(Event::class, $eventId)->setName('Renamed');
        $this->em->flush();
        $check('event edit');

        $this->em->getConnection()->executeStatement("UPDATE calendar SET content_version = 'bumped' WHERE id = ?", [$this->calB]);
        $check('calendar content bump');

        $this->em->find(CalendarFeed::class, $f)->setName('F2');
        $this->em->flush();
        $check('feed config');

        $this->assertSame(200, $this->api($this->memberId, 'POST', "/api/clubs/{$this->clubId}/my-subscription/rotate-secret")['status']);
        $old = $this->secret;
        $this->assertSame(404, $this->ics($old)[0], 'old secret dead at once');
        $this->subscribe($this->memberId, [$f, $g]);
        $check('rotation');
    }

    public function testAssignmentRevokeAndDemotionTakeEffectAtOnce(): void
    {
        $priv = $this->feed(FeedVisibility::PRIVATE, [$this->calA], 'Priv');
        $club = $this->feed(FeedVisibility::CLUB, [$this->calB], 'Club');
        $this->event($this->calA, 'Secret thing');
        $this->event($this->calB, 'Club thing');
        $viewer = TestHelper::createUser($this->em, $this->hasher, 'viewer@example.com');
        TestHelper::addMember($this->em, $this->club(), $viewer, ClubRole::VIEWER);
        $viewerId = $viewer->getId();

        // viewer (staff) sees the private feed
        $this->subscribe($viewerId, [$priv, $club]);
        $before = $this->etag();
        $this->assertSame(['Club thing', 'Secret thing'], $this->summaries($this->ics()[3]));

        $cu = $this->em->getRepository(ClubUser::class)->findOneBy(['user' => $viewerId]);
        $cu->setRole(ClubRole::MEMBER);
        $this->em->flush();
        $this->em->clear();
        [$status, $etag, , $body] = $this->ics(headers: ['HTTP_IF_NONE_MATCH' => $before]);
        $this->assertSame(200, $status, 'no 304 after demotion');
        $this->assertNotSame($before, $etag);
        $this->assertSame(['Club thing'], $this->summaries($body));

        // assigned member sees it, revoke removes it
        $this->em->persist(new FeedMember($this->em->find(CalendarFeed::class, $priv), $this->em->find(User::class, $viewerId), 'assigned', null));
        $this->em->flush();
        $this->em->clear();
        $assigned = $this->etag();
        $this->assertSame(['Club thing', 'Secret thing'], $this->summaries($this->ics()[3]));
        $this->em->getConnection()->executeStatement('DELETE FROM feed_member');
        [$status, $etag, , $body] = $this->ics(headers: ['HTTP_IF_NONE_MATCH' => $assigned]);
        $this->assertSame(200, $status);
        $this->assertNotSame($assigned, $etag);
        $this->assertSame(['Club thing'], $this->summaries($body));
    }

    public function testNotModifiedPathUsesFewLightQueriesAndNoRender(): void
    {
        $spy = new class extends IcsService {
            public int $calls = 0;

            public function streamFeedIcsForZone(string $timezone, iterable $chunks, ?string $calendarName = null): \Generator
            {
                ++$this->calls;

                return parent::streamFeedIcsForZone($timezone, $chunks, $calendarName);
            }
        };
        static::getContainer()->set(IcsService::class, $spy);
        static::getContainer()->set(\App\Service\PersonalFeedService::class, new \App\Service\PersonalFeedService(
            $this->em,
            static::getContainer()->get(\App\Service\PublicFeedService::class),
            $spy,
            static::getContainer()->get(\App\Ics\IcsEventReader::class),
            static::getContainer()->get(\App\Repository\HolidayEventRepository::class),
            static::getContainer()->get('request_stack'),
            static::getContainer()->get(\App\Security\Secret\SecretCipher::class),
        ));
        $feeds = [];
        for ($i = 0; $i < 4; ++$i) {
            $feeds[] = $this->feed(0 === $i % 2 ? FeedVisibility::PUBLIC : FeedVisibility::CLUB, [$this->calA, $this->calB], 'F'.$i);
        }
        $this->event($this->calA);
        $this->subscribe($this->memberId, $feeds, [$this->group('G')]);
        $etag = $this->etag();
        $this->assertSame(1, $spy->calls);

        $before = QueryCounter::$count;
        $this->assertSame(304, $this->ics(headers: ['HTTP_IF_NONE_MATCH' => $etag])[0]);
        $this->assertLessThanOrEqual(3, QueryCounter::$count - $before);
        $this->assertSame(1, $spy->calls, 'no render on 304');
    }

    public function testMyEventsRoleMatrix(): void
    {
        $base = "/api/clubs/{$this->clubId}/my-events";
        foreach ([ClubRole::MEMBER, ClubRole::VIEWER, ClubRole::EDITOR, ClubRole::ADMIN] as $i => $role) {
            $u = TestHelper::createUser($this->em, $this->hasher, "r$i@example.com");
            TestHelper::addMember($this->em, $this->club(), $u, $role);
            $this->assertSame(200, $this->api($u->getId(), 'GET', $base)['status'], $role->value);
        }
        $this->assertSame(401, $this->api(null, 'GET', $base)['status']);
        $this->assertSame(401, $this->api(null, 'GET', "$base/x")['status']);
        $outsider = TestHelper::createUser($this->em, $this->hasher, 'out@example.com');
        $this->assertSame(403, $this->api($outsider->getId(), 'GET', $base)['status']);
        $this->assertSame(403, $this->api($outsider->getId(), 'GET', "$base/x")['status']);
    }

    public function testMyEventsPayloadFiltersAndRanges(): void
    {
        $kids = $this->group('Kids');
        $adults = $this->group('Adults');
        $pub = $this->feed(FeedVisibility::CLUB, [$this->calA], 'Pub');
        $hidden = $this->feed(FeedVisibility::PRIVATE, [$this->calB], 'Hidden');
        $notSelected = $this->feed(FeedVisibility::CLUB, [$this->calB], 'NotSel');
        $e1 = $this->event($this->calA, 'Kids event', '2030-03-10');
        $e2 = $this->event($this->calA, 'Adults event', '2030-03-11');
        $this->event($this->calA, 'Draft', '2030-03-12', true);
        $hid = $this->event($this->calB, 'Hidden event', '2030-03-13');
        $this->assign($e1, $kids);
        $this->assign($e2, $adults);
        foreach (['u1', 'u2'] as $uid) {
            $hc = new HolidayCalendar($this->cal(0 === strcmp($uid, 'u1') ? $this->calA : $this->calA), 'Ferien '.$uid, 'https://example.com/'.$uid.'.ics');
            $this->em->persist($hc);
            $this->em->persist(new HolidayEvent($hc, 'same', 'Ferientag', new \DateTimeImmutable('2030-03-10')));
        }
        $this->em->flush();
        $base = "/api/clubs/{$this->clubId}/my-events";

        // no subscription yet: empty, no write
        $r = $this->api($this->memberId, 'GET', "$base?from=2030-03-01&to=2030-03-31");
        $this->assertSame([], $r['body']['events']);
        $this->assertSame(0, (int) $this->em->getConnection()->fetchOne('SELECT COUNT(*) FROM member_subscription'));

        $this->subscribe($this->memberId, [$pub], [$kids]);
        // a stale selection of a feed the member cannot access (e.g. after a revoke) must stay invisible
        $this->em->getConnection()->executeStatement('INSERT INTO member_subscription_feed (subscription_id, feed_id) VALUES (?, ?)', [$this->subId, $hidden]);
        $this->assertSame(200, $this->api($this->memberId, 'GET', "{$base}?from=2030-03-01")['status']);
        $r = $this->api($this->memberId, 'GET', "$base?from=2030-03-01&to=2030-03-31");
        $this->assertSame(['Kids event'], array_column($r['body']['events'], 'name'), 'default = subscription groups; hidden feed ignored');
        $this->assertSame(['id', 'name', 'clubName', 'timezone', 'visibility', 'indexable', 'eventCount', 'audiences'], array_keys($r['body']['feed']));
        $this->assertSame($this->subId, $r['body']['feed']['id']);
        $this->assertCount(1, $r['body']['holidays'], 'deduplicated by uid');
        $this->assertStringNotContainsString('secret', strtolower($r['content']));

        $r = $this->api($this->memberId, 'GET', "$base?from=2030-03-01&to=2030-03-31&targetGroupIds[]=$adults");
        $this->assertSame(['Adults event'], array_column($r['body']['events'], 'name'));
        $r = $this->api($this->memberId, 'GET', "$base?from=2030-03-01&to=2030-03-31&targetGroupIds[]=");
        $this->assertSame(['Kids event', 'Adults event'], array_column($r['body']['events'], 'name'), 'explicit empty = all groups');

        $this->assertSame(400, $this->api($this->memberId, 'GET', "$base?from=2030-03-10&to=2030-03-01")['status'], 'to before from, as the feed web view');
        $this->assertSame(400, $this->api($this->memberId, 'GET', "$base?from=nope")['status']);

        $this->assertSame(200, $this->api($this->memberId, 'GET', "$base/$e1")['status']);
        $one = $this->api($this->memberId, 'GET', "$base/$e1");
        $this->assertSame('Kids event', $one['body']['event']['name']);
        $this->assertSame(404, $this->api($this->memberId, 'GET', "$base/$hid")['status'], 'private feed not accessible to a member');
        $this->assertSame(404, $this->api($this->memberId, 'GET', "$base/nope")['status']);
        unset($notSelected);
    }

    public function testMyEventsPrivateFeedForAssignedMemberAndDraftNever(): void
    {
        $priv = $this->feed(FeedVisibility::PRIVATE, [$this->calA], 'Priv');
        $this->event($this->calA, 'Private event', '2030-04-01');
        $draft = $this->event($this->calA, 'Draft', '2030-04-02', true);
        $this->em->persist(new FeedMember($this->em->find(CalendarFeed::class, $priv), $this->em->find(User::class, $this->memberId), 'assigned', null));
        $this->em->flush();
        $this->subscribe($this->memberId, [$priv]);
        $base = "/api/clubs/{$this->clubId}/my-events";
        $r = $this->api($this->memberId, 'GET', "$base?from=2030-04-01&to=2030-04-30");
        $this->assertSame(['Private event'], array_column($r['body']['events'], 'name'));
        $this->assertSame(404, $this->api($this->memberId, 'GET', "$base/$draft")['status']);
    }
}
