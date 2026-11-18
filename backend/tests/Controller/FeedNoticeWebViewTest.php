<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Club;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Enum\EventType;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Notices appear in the web views (public feed, my-events) with `type`, but have no detail route. */
class FeedNoticeWebViewTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private TokenService $tokens;
    private string $clubId;
    private string $calId;
    private string $adminId;
    private string $groupId;
    private string $eventId;
    private string $noticeId;
    private string $draftNoticeId;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        $this->tokens = $c->get(TokenService::class);
        DatabaseResetter::reset($this->em);
        $admin = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class), 'admin@example.com');
        $club = TestHelper::createClub($this->em, $admin);
        $cal = TestHelper::createCalendar($this->em, $club, 'A');
        $this->clubId = $club->getId();
        $this->calId = $cal->getId();
        $this->adminId = $admin->getId();
        $this->groupId = TestHelper::createTargetGroup($this->em, $club, 'Youth')->getId();

        $this->eventId = TestHelper::createEvent($this->em, $cal, ['name' => 'Plain Event', 'date' => $this->day('+10 days'), 'isDraft' => false])->getId();
        $this->noticeId = $this->notice($cal, 'Holiday Closure', '+20 days', '+25 days', false)->getId();
        $this->draftNoticeId = $this->notice($cal, 'Draft Notice', '+10 days', null, true)->getId();
    }

    private function day(string $rel): string
    {
        return (new \DateTimeImmutable($rel))->format('Y-m-d');
    }

    private function notice(Calendar $cal, string $name, string $from, ?string $to, bool $draft): Event
    {
        $n = TestHelper::createEvent($this->em, $cal, ['name' => $name, 'date' => $this->day($from), 'isDraft' => $draft]);
        $n->setType(EventType::Notice)->setIsAllDay(true);
        if (null !== $to) {
            $n->setDateEnd(new \DateTimeImmutable($to));
        }
        $this->em->flush();

        return $n;
    }

    private function assign(string $eventId): void
    {
        $this->em->persist((new EventTargetGroup())->setEvent($this->em->find(Event::class, $eventId))->setTargetGroup($this->em->find(TargetGroup::class, $this->groupId)));
        $this->em->flush();
        $this->em->clear();
    }

    private function feed(FeedVisibility $v, ?string $secret = null): string
    {
        $club = $this->em->find(Club::class, $this->clubId);
        $cal = $this->em->find(Calendar::class, $this->calId);

        return TestHelper::createFeed($this->em, $club, [$cal], $v, 'Feed', $secret)->getId();
    }

    /** @return array{int, array<string, mixed>} */
    private function get(string $uri, ?string $userId = null): array
    {
        $auth = null === $userId ? '' : TestHelper::authHeader($this->em->find(User::class, $userId), $this->tokens);
        $r = TestHelper::jsonRequest($this->client, 'GET', $uri, [], $auth);
        $this->em->clear();

        return [$r['status'], $r['body']];
    }

    /** @param array<int, array<string, mixed>> $items */
    private function names(array $items): array
    {
        return array_column($items, 'name');
    }

    public function testPublicFeedListsPublishedNoticesWithType(): void
    {
        $feedId = $this->feed(FeedVisibility::PUBLIC);
        [$status, $body] = $this->get("/api/feed/$feedId/events");
        $this->assertSame(200, $status);
        $this->assertSame(['Plain Event', 'Holiday Closure'], $this->names($body['events']));
        $byName = array_column($body['events'], null, 'name');
        $this->assertSame('event', $byName['Plain Event']['type']);
        $n = $byName['Holiday Closure'];
        $this->assertSame('notice', $n['type']);
        $this->assertTrue($n['isAllDay']);
        $this->assertSame($this->day('+25 days'), $n['dateEnd']);
        $this->assertNull($n['location']);
        $this->assertSame([], $n['properties']);
        $this->assertSame([], $n['features']);
        $this->assertSame(1, $body['feed']['eventCount']);
        $this->assertSame(1, $body['feed']['noticeCount']);
    }

    public function testGroupFilterAppliesToNotices(): void
    {
        $this->assign($this->noticeId);
        $feedId = $this->feed(FeedVisibility::PUBLIC);
        [, $body] = $this->get("/api/feed/$feedId/events?targetGroupIds={$this->groupId}");
        $this->assertSame(['Holiday Closure'], $this->names($body['events']));
        $this->assertSame($this->groupId, $body['events'][0]['targetGroups'][0]['targetGroup']['id']);

        // A feed limited to a group drops notices without that group, like events.
        $club = $this->em->find(Club::class, $this->clubId);
        $limited = $this->feed(FeedVisibility::PUBLIC);
        $feed = $this->em->find(\App\Entity\CalendarFeed::class, $limited);
        $this->em->persist((new CalendarFeedTargetGroup())->setFeed($feed)->setTargetGroup($this->em->find(TargetGroup::class, $this->groupId)));
        $this->em->flush();
        $this->assertNotNull($club);
        [, $body] = $this->get("/api/feed/$limited/events");
        $this->assertSame(['Holiday Closure'], $this->names($body['events']));
    }

    public function testUngroupedNoticeDropsOutOfFilteredFeed(): void
    {
        $feedId = $this->feed(FeedVisibility::PUBLIC);
        [, $body] = $this->get("/api/feed/$feedId/events?targetGroupIds={$this->groupId}");
        $this->assertSame([], $body['events']);
    }

    public function testMultiDayNoticeOverlapWindow(): void
    {
        $feedId = $this->feed(FeedVisibility::PUBLIC);
        $from = $this->day('+23 days');
        $to = $this->day('+30 days');
        [, $body] = $this->get("/api/feed/$feedId/events?from=$from&to=$to");
        $this->assertSame(['Holiday Closure'], $this->names($body['events']));
        $from = $this->day('+26 days');
        [, $body] = $this->get("/api/feed/$feedId/events?from=$from&to=$to");
        $this->assertSame([], $body['events']);
    }

    public function testNoticeDetailIs404(): void
    {
        $feedId = $this->feed(FeedVisibility::PUBLIC);
        [$status] = $this->get("/api/feed/$feedId/events/{$this->noticeId}");
        $this->assertSame(404, $status);
        [$status] = $this->get("/api/feed/$feedId/events/{$this->eventId}");
        $this->assertSame(200, $status);
    }

    public function testPrivateFeedKeepsAccessRules(): void
    {
        $feedId = $this->feed(FeedVisibility::PRIVATE, 'sekret');
        [$status] = $this->get("/api/feed/$feedId/events");
        $this->assertSame(403, $status);
        [$status, $body] = $this->get("/api/feed/$feedId/events?secret=sekret");
        $this->assertSame(200, $status);
        $this->assertContains('Holiday Closure', $this->names($body['events']));
        $this->assertNotContains('Draft Notice', $this->names($body['events']));

        $clubFeed = $this->feed(FeedVisibility::CLUB);
        [$status, $body] = $this->get("/api/feed/$clubFeed/events");
        $this->assertSame(200, $status);
        $this->assertContains('Holiday Closure', $this->names($body['events']));
    }

    public function testMyEventsIncludesNoticesButNoDetail(): void
    {
        $feedId = $this->feed(FeedVisibility::CLUB);
        $r = TestHelper::jsonRequest($this->client, 'PUT', "/api/clubs/{$this->clubId}/my-subscription", ['feedIds' => [$feedId], 'targetGroupIds' => []], TestHelper::authHeader($this->em->find(User::class, $this->adminId), $this->tokens));
        $this->assertSame(200, $r['status'], $r['content']);

        [$status, $body] = $this->get("/api/clubs/{$this->clubId}/my-events", $this->adminId);
        $this->assertSame(200, $status);
        $this->assertSame(['Plain Event', 'Holiday Closure'], $this->names($body['events']));
        $this->assertSame('notice', $body['events'][1]['type']);
        $this->assertSame(1, $body['feed']['eventCount']);
        $this->assertSame(1, $body['feed']['noticeCount']);

        $from = $this->day('+23 days');
        $to = $this->day('+30 days');
        [, $body] = $this->get("/api/clubs/{$this->clubId}/my-events?from=$from&to=$to", $this->adminId);
        $this->assertSame(['Holiday Closure'], $this->names($body['events']));

        [$status] = $this->get("/api/clubs/{$this->clubId}/my-events/{$this->noticeId}", $this->adminId);
        $this->assertSame(404, $status);
        [$status] = $this->get("/api/clubs/{$this->clubId}/my-events/{$this->eventId}", $this->adminId);
        $this->assertSame(200, $status);
    }

    public function testMyEventsGroupFilter(): void
    {
        $this->assign($this->noticeId);
        $feedId = $this->feed(FeedVisibility::CLUB);
        $auth = TestHelper::authHeader($this->em->find(User::class, $this->adminId), $this->tokens);
        TestHelper::jsonRequest($this->client, 'PUT', "/api/clubs/{$this->clubId}/my-subscription", ['feedIds' => [$feedId], 'targetGroupIds' => [$this->groupId]], $auth);
        [, $body] = $this->get("/api/clubs/{$this->clubId}/my-events", $this->adminId);
        $this->assertSame(['Holiday Closure'], $this->names($body['events']));
    }
}
