<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\CalendarFeedCalendar;
use App\Entity\CalendarFeedTargetGroup;
use App\Entity\Club;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
use App\Enum\FeedVisibility;
use App\Service\IcsService;
use App\Service\PublicFeedService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** ETag / 304 of GET /api/feed/:id/ics and the normalized targetGroupIds filter. */
class FeedIcsEtagTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private Club $club;
    private Calendar $calendar;
    private CalendarFeed $feed;
    private object $spy;
    private string $clubId;
    private string $calendarId;
    private string $feedId;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->spy = new class extends IcsService {
            public int $calls = 0;

            public function buildIcs(CalendarFeed $feed, Club $club, iterable $events): string
            {
                ++$this->calls;

                return parent::buildIcs($feed, $club, $events);
            }
        };
        $c->set(IcsService::class, $this->spy);
        $c->set(PublicFeedService::class, new PublicFeedService(
            $c->get(EntityManagerInterface::class),
            $this->spy,
            $c->get(\App\Ics\IcsEventReader::class),
            $c->get(\App\Repository\HolidayEventRepository::class),
            $c->get('request_stack'),
        ));
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $this->club = TestHelper::createClub($this->em, $user);
        $this->calendar = TestHelper::createCalendar($this->em, $this->club);
        $this->feed = TestHelper::createFeed($this->em, $this->club, [$this->calendar], FeedVisibility::PUBLIC);
        $this->clubId = $this->club->getId();
        $this->calendarId = $this->calendar->getId();
        $this->feedId = $this->feed->getId();
    }

    /** The kernel resets the entity manager after each request: reload before mutating. */
    private function reload(): void
    {
        $this->em->clear();
        $this->club = $this->em->find(Club::class, $this->clubId);
        $this->calendar = $this->em->find(Calendar::class, $this->calendarId);
        $this->feed = $this->em->find(CalendarFeed::class, $this->feedId);
    }

    /** @return array{0: int, 1: ?string, 2: \Symfony\Component\HttpFoundation\Response} */
    private function get(string $query = '', array $headers = [], ?CalendarFeed $feed = null): array
    {
        $id = ($feed ?? $this->feed)->getId();
        $this->client->request('GET', "/api/feed/$id/ics".$query, [], [], $headers);
        $r = $this->client->getResponse();
        $this->reload();

        return [$r->getStatusCode(), $r->headers->get('ETag'), $r];
    }

    private function etag(string $query = ''): string
    {
        [$status, $etag] = $this->get($query);
        $this->assertSame(200, $status);
        $this->assertNotNull($etag);

        return $etag;
    }

    private function published(string $name = 'E'): Event
    {
        return TestHelper::createEvent($this->em, $this->calendar, ['name' => $name, 'date' => (new \DateTimeImmutable('+10 days'))->format('Y-m-d'), 'isDraft' => false]);
    }

    public function testEtagHeadersAnd304WithoutRender(): void
    {
        $this->published();
        [$status, $etag, $r] = $this->get();
        $this->assertSame(200, $status);
        $this->assertMatchesRegularExpression('/^"[0-9a-f]{32}"$/', $etag);
        $this->assertSame('no-cache, public', $r->headers->get('Cache-Control'));
        $this->assertStringContainsString('BEGIN:VCALENDAR', (string) $r->getContent());
        $this->assertSame(1, $this->spy->calls);

        foreach ([$etag, 'W/'.$etag, '"other", '.$etag, '*'] as $inm) {
            [$status, $etag304, $r] = $this->get('', ['HTTP_IF_NONE_MATCH' => $inm]);
            $this->assertSame(304, $status, $inm);
            $this->assertSame($etag, $etag304);
            $this->assertSame('', (string) $r->getContent());
            $this->assertSame('no-cache, public', $r->headers->get('Cache-Control'));
            $this->assertNull($r->headers->get('X-Robots-Tag'), 'public feed is indexable');
            $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
        }
        $this->assertSame(1, $this->spy->calls, 'no render on 304');

        [$status] = $this->get('', ['HTTP_IF_NONE_MATCH' => '"stale"']);
        $this->assertSame(200, $status);
    }

    public function testNonIndexableFeedKeepsNoindexOn304(): void
    {
        $club = TestHelper::createFeed($this->em, $this->em->find(Club::class, $this->clubId), [$this->em->find(Calendar::class, $this->calendarId)], FeedVisibility::CLUB);
        [, $etag, $r] = $this->get('', [], $club);
        $this->assertSame('noindex', $r->headers->get('X-Robots-Tag'));
        $this->assertSame('no-cache, public', $r->headers->get('Cache-Control'));
        [$status, , $r] = $this->get('', ['HTTP_IF_NONE_MATCH' => $etag], $club);
        $this->assertSame(304, $status);
        $this->assertSame('noindex', $r->headers->get('X-Robots-Tag'));
        $this->assertSame('no-referrer', $r->headers->get('Referrer-Policy'));
    }

    public function testEtagStableOnReadsAndUnrelatedChanges(): void
    {
        $this->published();
        $etag = $this->etag();
        $this->assertSame($etag, $this->etag());

        $other = TestHelper::createCalendar($this->em, $this->club, 'Other');
        TestHelper::createEvent($this->em, $other, ['name' => 'X', 'isDraft' => false]);
        $this->assertSame($etag, $this->etag());
    }

    public function testEtagChangesOnEventChanges(): void
    {
        $e = $this->published();
        $seen = [$this->etag()];

        $e = $this->em->find(Event::class, $e->getId());
        $e->setName('Renamed');
        $this->em->flush();
        $seen[] = $this->etag();

        $e2 = $this->published('Second');
        $seen[] = $this->etag();

        $this->em->remove($this->em->find(Event::class, $e2->getId()));
        $this->em->flush();
        $seen[] = $this->etag();

        $this->assertCount(3, array_unique(array_slice($seen, 0, 3)));
        $this->assertNotSame($seen[2], $seen[3]);
    }

    public function testEtagChangesOnTargetGroupRename(): void
    {
        $e = $this->published();
        $tg = TestHelper::createTargetGroup($this->em, $this->club, 'Jugend');
        $this->em->persist((new EventTargetGroup())->setEvent($e)->setTargetGroup($tg));
        $this->em->flush();
        $before = $this->etag();
        $tg = $this->em->find(\App\Entity\TargetGroup::class, $tg->getId());
        $tg->setName('Kids');
        $this->em->flush();
        $this->assertNotSame($before, $this->etag());
    }

    public function testEtagChangesOnArchiveSelectionSecretAndVisibility(): void
    {
        $second = TestHelper::createCalendar($this->em, $this->club, 'Second');
        $link = (new CalendarFeedCalendar())->setFeed($this->feed)->setCalendar($second);
        $this->em->persist($link);
        $this->feed->getCalendars()->add($link);
        $this->em->flush();
        $withBoth = $this->etag();

        $second = $this->em->find(Calendar::class, $second->getId());
        $second->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();
        $archived = $this->etag();
        $this->assertNotSame($withBoth, $archived);

        $removed = $archived;

        $this->feed->setSharedSecret('rotated-secret-value');
        $this->em->flush();
        $rotated = $this->etag();
        $this->assertNotSame($removed, $rotated);

        $this->feed->setVisibility(FeedVisibility::CLUB);
        $this->em->flush();
        $this->assertNotSame($rotated, $this->etag());
    }

    public function testRemovingCalendarFromSelectionChangesEtag(): void
    {
        $second = TestHelper::createCalendar($this->em, $this->club, 'Second');
        $link = (new CalendarFeedCalendar())->setFeed($this->feed)->setCalendar($second);
        $this->em->persist($link);
        $this->feed->getCalendars()->add($link);
        $this->em->flush();
        $before = $this->etag();
        $link = $this->feed->getCalendars()->filter(fn ($l) => 'Second' === $l->getCalendar()->getName())->first();
        $this->feed->getCalendars()->removeElement($link);
        $this->em->remove($link);
        $this->em->flush();
        $this->assertNotSame($before, $this->etag());
    }

    public function testFilterNormalization(): void
    {
        $a = TestHelper::createTargetGroup($this->em, $this->club, 'A');
        $b = TestHelper::createTargetGroup($this->em, $this->club, 'B');
        $ia = $a->getId();
        $ib = $b->getId();
        $this->assertSame($this->etag("?targetGroupIds=$ia,$ib"), $this->etag("?targetGroupIds=$ib,$ia,$ia,%20,"));
        $this->assertNotSame($this->etag("?targetGroupIds=$ia,$ib"), $this->etag("?targetGroupIds=$ia"));
        $this->assertNotSame($this->etag("?targetGroupIds=$ia"), $this->etag("?targetGroupIds=$ib"));
        $this->assertSame($this->etag(), $this->etag('?targetGroupIds=,'));
        $this->assertSame(['a', 'b'], PublicFeedService::normalizeTargetGroupIds(' b ,a,,a'));
        $this->assertNull(PublicFeedService::normalizeTargetGroupIds(' , '));
    }

    public function testFilterIntersectsWithFeedTargetGroups(): void
    {
        $a = TestHelper::createTargetGroup($this->em, $this->club, 'A');
        $b = TestHelper::createTargetGroup($this->em, $this->club, 'B');
        $link = (new CalendarFeedTargetGroup())->setFeed($this->feed)->setTargetGroup($a);
        $this->em->persist($link);
        $this->feed->getTargetGroups()->add($link);
        $this->em->flush();
        $ia = $a->getId();
        $ib = $b->getId();
        // Both reduce to the feed's own set {a}
        $this->assertSame($this->etag(), $this->etag("?targetGroupIds=$ia,$ib"));
        $this->assertSame($this->etag(), $this->etag("?targetGroupIds=$ia"));
        // Nothing allowed left differs
        $this->assertNotSame($this->etag(), $this->etag("?targetGroupIds=$ib"));
    }

    public function testPrivateFeedNever304WithoutSecret(): void
    {
        $private = TestHelper::createFeed($this->em, $this->club, [$this->calendar], FeedVisibility::PRIVATE, 'Priv', 'topsecret');
        [$status, $etag, $r] = $this->get('?secret=topsecret', [], $private);
        $this->assertSame(200, $status);
        $this->assertSame('no-cache, private', $r->headers->get('Cache-Control'));

        foreach (['', '?secret=wrong'] as $q) {
            [$status, $etag304] = $this->get($q, ['HTTP_IF_NONE_MATCH' => $etag], $private);
            $this->assertContains($status, [401, 403, 404]);
            $this->assertNull($etag304);
        }
        [$status] = $this->get('?secret=topsecret', ['HTTP_IF_NONE_MATCH' => $etag], $private);
        $this->assertSame(304, $status);

        // The secret is not part of the ETag value (rotation changes it, but equal state gives equal tag)
        $this->assertStringNotContainsString('topsecret', $etag);
    }

    public function testAllArchivedIs404EvenWithEtag(): void
    {
        $etag = $this->etag();
        $this->calendar->setArchivedAt(new \DateTimeImmutable());
        $this->em->flush();
        [$status] = $this->get('', ['HTTP_IF_NONE_MATCH' => $etag]);
        $this->assertSame(404, $status);
    }
}
