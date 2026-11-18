<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Calendar;
use App\Entity\Event;
use App\Entity\EventTargetGroup;
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

/** Notices (event type `notice`) never appear in any ICS output. */
class IcsNoticeExclusionTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private TokenService $tokens;
    private User $admin;
    private string $calId;
    private string $feedId;
    private string $eventId;
    private string $noticeId;

    protected function setUp(): void
    {
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        $this->tokens = $c->get(TokenService::class);
        DatabaseResetter::reset($this->em);
        ['user' => $this->admin, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $c->get(UserPasswordHasherInterface::class));
        $this->calId = $cal->getId();
        $this->feedId = TestHelper::createFeed($this->em, $club, [$cal], FeedVisibility::PUBLIC)->getId();
        $this->clubId = $club->getId();

        $start = (new \DateTimeImmutable('+10 days'))->format('Y-m-d');
        $this->eventId = TestHelper::createEvent($this->em, $cal, ['name' => 'Normal Event', 'date' => $start, 'isDraft' => false])->getId();

        $tg = TestHelper::createTargetGroup($this->em, $club, 'Youth');
        $notice = TestHelper::createEvent($this->em, $cal, ['name' => 'Notice Holiday', 'date' => $start, 'isDraft' => false]);
        $notice->setType(EventType::Notice)->setIsAllDay(true)->setDateEnd(new \DateTimeImmutable('+12 days'));
        $this->em->persist((new EventTargetGroup())->setEvent($notice)->setTargetGroup($tg));
        $this->em->flush();
        $this->noticeId = $notice->getId();
    }

    private string $clubId;

    private function body(string $uri, string $auth = ''): string
    {
        $this->client->request('GET', $uri, [], [], '' === $auth ? [] : ['HTTP_AUTHORIZATION' => $auth]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());

        return (string) $this->client->getInternalResponse()->getContent();
    }

    private function assertOnlyEvent(string $ics): void
    {
        $this->assertStringContainsString('Normal Event', $ics);
        $this->assertStringNotContainsString('Notice Holiday', $ics);
        $this->assertStringNotContainsString($this->noticeId, $ics);
    }

    public function testFeedIcs(): void
    {
        $this->assertOnlyEvent($this->body("/api/feed/{$this->feedId}/ics"));
    }

    public function testOneEventIcs(): void
    {
        $this->assertStringContainsString('Normal Event', $this->body("/api/feed/{$this->feedId}/events/{$this->eventId}/ics"));
        $this->client->request('GET', "/api/feed/{$this->feedId}/events/{$this->noticeId}/ics");
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());
    }

    public function testMemberExportIncludingDrafts(): void
    {
        $auth = TestHelper::authHeader($this->admin, $this->tokens);
        $cal = $this->em->find(Calendar::class, $this->calId);
        $draftNotice = TestHelper::createEvent($this->em, $cal, ['name' => 'Draft Notice', 'date' => (new \DateTimeImmutable('+11 days'))->format('Y-m-d'), 'isDraft' => true]);
        $draftNotice->setType(EventType::Notice)->setIsAllDay(true);
        $this->em->flush();

        foreach (['', '?includeDrafts=1'] as $q) {
            $ics = $this->body("/api/calendars/{$this->calId}/events.ics$q", $auth);
            $this->assertOnlyEvent($ics);
            $this->assertStringNotContainsString('Draft Notice', $ics);
        }
    }

    public function testPersonalIcs(): void
    {
        $auth = TestHelper::authHeader($this->admin, $this->tokens);
        $this->client->request('PUT', "/api/clubs/{$this->clubId}/my-subscription", [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $auth], json_encode(['feedIds' => [$this->feedId], 'targetGroupIds' => []]));
        $sub = json_decode((string) $this->client->getResponse()->getContent(), true);
        $this->assertArrayHasKey('secret', $sub);

        $this->assertOnlyEvent($this->body("/api/feed/me/{$sub['id']}/ics?secret=".rawurlencode($sub['secret'])));
    }
}
