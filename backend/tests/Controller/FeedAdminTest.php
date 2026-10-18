<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Feed administration per club (`/api/clubs/{id}/feeds`): a feed selects one or more calendars of the club
 * (`calendarIds`), calendar lifecycle (delete removes only exclusive feeds, duplicate copies no feeds or
 * reference data) and the role rules (reads editor+, writes admin).
 */
class FeedAdminTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    private function req(string $method, string $uri, User $user, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, TestHelper::authHeader($user, self::$tokens));
    }

    /** @return array{user: User, club: Club, a: Calendar, b: Calendar, base: string} */
    private function setup2(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $a] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $b = TestHelper::createCalendar(self::$em, $club, 'Zweiter');

        return ['user' => $user, 'club' => $club, 'a' => $a, 'b' => $b, 'base' => "/api/clubs/{$club->getId()}/feeds"];
    }

    public function testCreateReadUpdateAndDeleteAFeedWithSeveralCalendars(): void
    {
        ['user' => $user, 'a' => $a, 'b' => $b, 'club' => $club, 'base' => $base] = $this->setup2();
        $ids = [$a->getId(), $b->getId()];
        sort($ids);

        $r = $this->req('POST', $base.'?includeSecret=1', $user, ['name' => 'Beide', 'visibility' => 'PUBLIC', 'calendarIds' => [$b->getId(), $a->getId(), $a->getId()]]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame($ids, $r['body']['calendarIds']);
        $this->assertSame($club->getId(), $r['body']['clubId']);
        $this->assertArrayNotHasKey('calendarId', $r['body']);
        $this->assertNotEmpty($r['body']['sharedSecret']);
        $id = $r['body']['id'];

        $this->assertSame($r['body'], $this->req('GET', "$base/$id?includeSecret=1", $user)['body']);
        $this->assertSame([$id], array_column($this->req('GET', $base, $user)['body'], 'id'));

        $this->assertSame(200, $this->req('DELETE', "$base/$id", $user)['status']);
        $this->assertSame(404, $this->req('GET', "$base/$id", $user)['status']);
        $this->assertSame(0, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM calendar_feed_calendar'));
    }

    public function testOldCalendarRoutesAreGone(): void
    {
        ['user' => $user, 'a' => $a] = $this->setup2();
        $this->assertSame(404, $this->req('GET', "/api/calendars/{$a->getId()}/feeds", $user)['status']);
    }

    public function testCalendarIdsAreValidated(): void
    {
        ['user' => $user, 'a' => $a, 'base' => $base] = $this->setup2();
        ['calendar' => $foreign] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        foreach ([[], null, 'x', [[]], [1.5]] as $value) {
            $data = ['name' => 'F'] + (null === $value ? [] : ['calendarIds' => $value]);
            $r = $this->req('POST', $base, $user, $data);
            $this->assertContains($r['status'], [400, 422], json_encode($value));
            $this->assertSame(['validation_failed', 'calendarIds'], [$r['body']['code'], $r['body']['field']], json_encode($value));
        }
        $empty = $this->req('POST', $base, $user, ['name' => 'F', 'calendarIds' => []]);
        $this->assertSame(422, $empty['status']);

        // A calendar of another club and an unknown id look the same
        foreach ([$foreign->getId(), '0190a4c2-0000-7000-8000-000000000000', [$a->getId(), $foreign->getId()]] as $bad) {
            $r = $this->req('POST', $base, $user, ['name' => 'F', 'calendarIds' => (array) $bad]);
            $this->assertSame(422, $r['status']);
            $this->assertSame(['unknown_reference', 'calendarIds'], [$r['body']['code'], $r['body']['field']]);
        }
        $this->assertSame(0, self::$em->getRepository(CalendarFeed::class)->count([]));
    }

    public function testPatchSyncsCalendarsAndKeepsThemWhenOmitted(): void
    {
        ['user' => $user, 'a' => $a, 'b' => $b, 'base' => $base] = $this->setup2();
        $c = TestHelper::createCalendar(self::$em, $a->getClub(), 'Dritter');
        $id = $this->req('POST', $base, $user, ['name' => 'F', 'calendarIds' => [$a->getId()]])['body']['id'];

        $this->assertSame([$a->getId()], $this->req('PATCH', "$base/$id", $user, ['name' => 'Neu'])['body']['calendarIds'], 'omitted: unchanged');

        $r = $this->req('PATCH', "$base/$id", $user, ['calendarIds' => [$a->getId(), $b->getId()]]);
        $expected = [$a->getId(), $b->getId()];
        sort($expected);
        $this->assertSame($expected, $r['body']['calendarIds']);

        $r = $this->req('PATCH', "$base/$id", $user, ['calendarIds' => [$c->getId(), $a->getId()]]);
        $this->assertSame(200, $r['status'], $r['content']);
        $expected = [$a->getId(), $c->getId()];
        sort($expected);
        $this->assertSame($expected, $r['body']['calendarIds']);
        $this->assertSame($expected, $this->req('GET', "$base/$id", $user)['body']['calendarIds']);

        // Sent but empty or foreign: rejected, nothing changes
        $this->assertSame(422, $this->req('PATCH', "$base/$id", $user, ['calendarIds' => []])['status']);
        ['calendar' => $foreign] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $r = $this->req('PATCH', "$base/$id", $user, ['calendarIds' => [$foreign->getId()]]);
        $this->assertSame(['unknown_reference', 'calendarIds'], [$r['body']['code'], $r['body']['field']]);
        self::$em->clear();
        $this->assertSame($expected, $this->req('GET', "$base/$id", $user)['body']['calendarIds']);
    }

    public function testArchivedCalendarsAreSelectable(): void
    {
        ['user' => $user, 'a' => $a, 'base' => $base] = $this->setup2();
        $a->setArchivedAt(new \DateTimeImmutable());
        self::$em->flush();
        $r = $this->req('POST', $base, $user, ['name' => 'Archiv', 'calendarIds' => [$a->getId()]]);
        $this->assertSame(201, $r['status'], $r['content']);
    }

    public function testTargetGroupsAreResolvedInTheClubOfTheFeed(): void
    {
        ['user' => $user, 'a' => $a, 'club' => $club, 'base' => $base] = $this->setup2();
        $group = TestHelper::createTargetGroup(self::$em, $club);
        $otherClub = TestHelper::createClub(self::$em, self::$em->find(User::class, $user->getId()), 'Anderer');
        $foreignGroup = TestHelper::createTargetGroup(self::$em, $otherClub);

        $ok = $this->req('POST', $base, $user, ['name' => 'F', 'calendarIds' => [$a->getId()], 'targetGroupIds' => [$group->getId()]]);
        $this->assertSame(201, $ok['status'], $ok['content']);
        $bad = $this->req('POST', $base, $user, ['name' => 'G', 'calendarIds' => [$a->getId()], 'targetGroupIds' => [$foreignGroup->getId()]]);
        $this->assertSame(422, $bad['status']);
        $this->assertSame('targetGroupIds', $bad['body']['field']);
    }

    public function testViewerCannotListFeedsEditorReadsButCannotWrite(): void
    {
        ['user' => $admin, 'club' => $club, 'a' => $a, 'base' => $base] = $this->setup2();
        $feed = TestHelper::createFeed(self::$em, $club, [$a]);
        $viewer = TestHelper::createUser(self::$em, self::$hasher, 'v@example.com');
        $editor = TestHelper::createUser(self::$em, self::$hasher, 'e@example.com');
        TestHelper::addMember(self::$em, $club, $viewer, ClubRole::VIEWER);
        TestHelper::addMember(self::$em, $club, $editor, ClubRole::EDITOR);
        $one = "$base/{$feed->getId()}";

        $this->assertSame(403, $this->req('GET', $base.'?includeSecret=1', $viewer)['status']);
        $this->assertSame(403, $this->req('GET', $one.'?includeSecret=1', $viewer)['status']);

        $this->assertSame(200, $this->req('GET', $base, $editor)['status']);
        $this->assertSame($feed->getSharedSecret(), $this->req('GET', $one.'?includeSecret=1', $editor)['body']['sharedSecret']);
        $this->assertSame(403, $this->req('POST', $base, $editor, ['name' => 'X', 'calendarIds' => [$a->getId()]])['status']);
        $this->assertSame(403, $this->req('PATCH', $one, $editor, ['name' => 'X'])['status']);
        $this->assertSame(403, $this->req('POST', "$one/regenerate-secret", $editor)['status']);
        $this->assertSame(403, $this->req('DELETE', $one, $editor)['status']);

        $this->assertSame(200, $this->req('PATCH', $one, $admin, ['name' => 'X'])['status']);
        $new = $this->req('POST', "$one/regenerate-secret?includeSecret=1", $admin)['body']['sharedSecret'];
        $this->assertNotSame($feed->getSharedSecret(), $new);
    }

    public function testDeletingACalendarRemovesOnlyItsExclusiveFeeds(): void
    {
        ['user' => $user, 'club' => $club, 'a' => $a, 'b' => $b, 'base' => $base] = $this->setup2();
        $own = TestHelper::createFeed(self::$em, $club, [$a], FeedVisibility::PUBLIC, 'Nur A');
        $shared = TestHelper::createFeed(self::$em, $club, [$a, $b], FeedVisibility::PUBLIC, 'A und B');
        $other = TestHelper::createFeed(self::$em, $club, [$b], FeedVisibility::PUBLIC, 'Nur B');
        $ownId = $own->getId();
        $sharedId = $shared->getId();
        $otherId = $other->getId();

        $cal = $this->req('GET', "/api/clubs/{$club->getId()}/calendars/{$a->getId()}", $user)['body'];
        $this->assertSame([2, 1], [$cal['feedCount'], $cal['exclusiveFeedCount']]);

        $this->assertSame(200, $this->req('DELETE', "/api/clubs/{$club->getId()}/calendars/{$a->getId()}", $user)['status']);
        self::$em->clear();

        $names = array_column($this->req('GET', $base, $user)['body'], null, 'id');
        $this->assertArrayNotHasKey($ownId, $names);
        $this->assertSame([$b->getId()], $names[$sharedId]['calendarIds']);
        $this->assertSame([$b->getId()], $names[$otherId]['calendarIds']);
        $this->assertSame(2, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM calendar_feed'));
        $this->assertSame(2, (int) self::$em->getConnection()->fetchOne('SELECT COUNT(*) FROM calendar_feed_calendar'));
    }

    public function testDuplicateCopiesPropertiesAndFeaturesButSharesClubLevelDataAndCopiesNoFeeds(): void
    {
        ['user' => $user, 'club' => $club, 'a' => $a] = $this->setup2();
        $loc = TestHelper::createLocation(self::$em, $club);
        $prop = TestHelper::createProperty(self::$em, $a, 'Tracht', '👔');
        $unusedProp = TestHelper::createProperty(self::$em, $a, 'Ungenutzt');
        $feature = TestHelper::createFeature(self::$em, $a, 'Bonus');
        $group = TestHelper::createTargetGroup(self::$em, $club);
        TestHelper::createFeed(self::$em, $club, [$a]);
        $clubBase = "/api/clubs/{$club->getId()}";
        $tpl = $this->req('POST', "/api/calendars/{$a->getId()}/templates", $user, [
            'name' => 'Vorlage', 'timeBegin' => '18:00', 'timeEnd' => '20:00',
            'locationId' => $loc->getId(), 'propertyIds' => [$prop->getId()], 'featureIds' => [$feature->getId()], 'targetGroupIds' => [$group->getId()],
        ]);
        $this->assertSame(201, $tpl['status'], $tpl['content']);

        $copy = $this->req('POST', "$clubBase/calendars/{$a->getId()}/duplicate", $user, ['name' => 'Kopie']);
        $this->assertSame(201, $copy['status'], $copy['content']);
        $this->assertSame([1, 0, 0], [$copy['body']['templateCount'], $copy['body']['feedCount'], $copy['body']['exclusiveFeedCount']]);
        $copyId = $copy['body']['id'];

        // Properties and features are calendar-level: the copy has its own, the originals are untouched
        $copyProps = $this->req('GET', "/api/calendars/$copyId/properties", $user)['body'];
        $this->assertEqualsCanonicalizing(['Tracht', 'Ungenutzt'], array_column($copyProps, 'name'));
        $this->assertEqualsCanonicalizing(['👔', null], array_column($copyProps, 'icon'));
        $this->assertNotContains($prop->getId(), array_column($copyProps, 'id'));
        $this->assertNotContains($unusedProp->getId(), array_column($copyProps, 'id'));
        $copyFeatures = $this->req('GET', "/api/calendars/$copyId/features", $user)['body'];
        $this->assertSame(['Bonus'], array_column($copyFeatures, 'name'));
        $this->assertCount(2, $this->req('GET', "/api/calendars/{$a->getId()}/properties", $user)['body']);

        // The copied template points at the copy's own property/feature and the shared club-level data
        $templates = $this->req('GET', "/api/calendars/$copyId/templates", $user)['body'];
        $this->assertSame($loc->getId(), $templates[0]['locationId'] ?? $templates[0]['location']['id'] ?? null, 'club-level location is shared');
        $copiedPropertyId = $copyProps[array_search('Tracht', array_column($copyProps, 'name'), true)]['id'];
        $this->assertSame([$copiedPropertyId], array_column($templates[0]['properties'], 'propertyId'));
        $this->assertSame([$copyFeatures[0]['id']], array_column($templates[0]['features'], 'featureId'));
        $this->assertSame([$group->getId()], array_column($templates[0]['targetGroups'], 'targetGroupId'));

        $conn = self::$em->getConnection();
        $this->assertSame([1, 4, 2, 1, 1], [
            (int) $conn->fetchOne('SELECT COUNT(*) FROM location'),
            (int) $conn->fetchOne('SELECT COUNT(*) FROM property'),
            (int) $conn->fetchOne('SELECT COUNT(*) FROM feature'),
            (int) $conn->fetchOne('SELECT COUNT(*) FROM target_group'),
            (int) $conn->fetchOne('SELECT COUNT(*) FROM calendar_feed'),
        ]);

        // The copied template still works: an event from it on the copy
        $event = $this->req('POST', "/api/calendars/$copyId/events", $user, [
            'name' => 'Aus Vorlage', 'date' => '2026-10-24', 'timeBegin' => '18:00', 'timeEnd' => '20:00', 'propertyIds' => [$copiedPropertyId],
        ]);
        $this->assertSame(201, $event['status'], $event['content']);
    }
}
