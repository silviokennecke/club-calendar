<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Event;
use App\Enum\FeedVisibility;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Optional plain-text `note` of events and templates. */
class EventNoteTest extends WebTestCase
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

    /** @return array{auth: string, base: string, clubId: string, calId: string} */
    private function prepare(): array
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);

        return ['auth' => TestHelper::authHeader($user, self::$tokens), 'base' => "/api/calendars/{$cal->getId()}", 'clubId' => $club->getId(), 'calId' => $cal->getId()];
    }

    private function req(string $method, string $uri, string $auth, array $data = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $data, $auth);
    }

    private function event(array $extra = []): array
    {
        return $extra + ['name' => 'Training', 'date' => '2026-10-03', 'timeBegin' => '19:00', 'timeEnd' => '21:00'];
    }

    public function testCreateUpdateAndClearEventNote(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();

        $r = $this->req('POST', "$base/events", $auth, $this->event(['note' => "  Zeile 1\nZeile 2  "]));
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame("Zeile 1\nZeile 2", $r['body']['note']);
        $id = $r['body']['id'];

        $this->assertNull($this->req('POST', "$base/events", $auth, $this->event())['body']['note']);

        // omitted = unchanged
        $r = $this->req('PATCH', "$base/events/$id", $auth, ['name' => 'Neu']);
        $this->assertSame("Zeile 1\nZeile 2", $r['body']['note']);
        $this->assertSame("Zeile 1\nZeile 2", $this->req('GET', "$base/events/$id", $auth)['body']['note']);

        $r = $this->req('PATCH', "$base/events/$id", $auth, ['note' => 'Anders']);
        $this->assertSame('Anders', $r['body']['note']);

        foreach ([null, '', "  \n "] as $empty) {
            $this->req('PATCH', "$base/events/$id", $auth, ['note' => 'x']);
            $r = $this->req('PATCH', "$base/events/$id", $auth, ['note' => $empty]);
            $this->assertSame(200, $r['status'], $r['content']);
            $this->assertNull($r['body']['note']);
        }

        $list = $this->req('GET', "$base/events", $auth)['body'];
        $this->assertArrayHasKey('note', $list[0]);
    }

    public function testNoteValidation(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();

        $r = $this->req('POST', "$base/events", $auth, $this->event(['note' => str_repeat('ä', 2000)]));
        $this->assertSame(201, $r['status'], $r['content']);
        $id = $r['body']['id'];

        $r = $this->req('POST', "$base/events", $auth, $this->event(['note' => str_repeat('a', 2001)]));
        $this->assertSame(422, $r['status']);
        $this->assertSame('validation_failed', $r['body']['code']);
        $this->assertSame('note', $r['body']['field']);

        $this->assertSame(422, $this->req('PATCH', "$base/events/$id", $auth, ['note' => str_repeat('a', 2001)])['status']);
        $this->assertSame(422, $this->req('PATCH', "$base/events/$id", $auth, ['note' => 5])['status']);
        $r = $this->req('POST', "$base/templates", $auth, ['name' => 'T', 'note' => str_repeat('a', 2001)]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('note', $r['body']['field']);
    }

    public function testTemplateNoteIsCopiedToEvents(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();

        $t = $this->req('POST', "$base/templates", $auth, ['name' => 'Vorlage', 'timeBegin' => '19:00', 'timeEnd' => '20:00', 'note' => "Bitte\nmitbringen"]);
        $this->assertSame(201, $t['status'], $t['content']);
        $this->assertSame("Bitte\nmitbringen", $t['body']['note']);
        $tid = $t['body']['id'];
        $this->assertSame("Bitte\nmitbringen", $this->req('GET', "$base/templates", $auth)['body'][0]['note']);

        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $tid, 'dates' => ['2026-10-03', '2026-10-04']]);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame("Bitte\nmitbringen", $r['body'][0]['note']);

        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $tid, 'dates' => ['2026-10-05'], 'overrides' => ['note' => 'Eigene']]);
        $this->assertSame('Eigene', $r['body'][0]['note']);
        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $tid, 'dates' => ['2026-10-06'], 'overrides' => ['note' => null]]);
        $this->assertNull($r['body'][0]['note']);

        $rule = ['frequency' => 'weekly', 'weekday' => 4, 'startDate' => '2026-10-03', 'until' => '2026-10-31', 'skipHolidays' => false];
        $s = $this->req('POST', "$base/events/series", $auth, ['rule' => $rule, 'templateId' => $tid]);
        $this->assertSame(201, $s['status'], $s['content']);
        foreach ($s['body']['events'] as $e) {
            $this->assertSame("Bitte\nmitbringen", $e['note']);
        }

        // series event with own note, scope all changes every event
        $s2 = $this->req('POST', "$base/events/series", $auth, ['rule' => $rule, 'event' => ['name' => 'S', 'timeBegin' => '10:00', 'timeEnd' => '11:00', 'note' => 'Reihe']]);
        $this->assertSame('Reihe', $s2['body']['events'][0]['note']);
        $first = $s2['body']['events'][0]['id'];
        $this->req('PATCH', "$base/events/$first", $auth, ['note' => 'Alle neu', 'scope' => 'all']);
        foreach ($this->req('GET', "$base/events", $auth)['body'] as $e) {
            if ('S' === $e['name']) {
                $this->assertSame('Alle neu', $e['note']);
            }
        }

        // template update and clear
        $r = $this->req('PATCH', "$base/templates/$tid", $auth, ['note' => null]);
        $this->assertNull($r['body']['note']);
    }

    public function testDuplicateCalendarCopiesTemplateNotes(): void
    {
        ['auth' => $auth, 'base' => $base, 'clubId' => $clubId, 'calId' => $calId] = $this->prepare();
        $this->req('POST', "$base/templates", $auth, ['name' => 'V', 'note' => 'Kopierte Notiz']);

        $r = $this->req('POST', "/api/clubs/$clubId/calendars/$calId/duplicate", $auth);
        $this->assertSame(201, $r['status'], $r['content']);
        $copy = $this->req('GET', "/api/calendars/{$r['body']['id']}/templates", $auth);
        $this->assertSame('Kopierte Notiz', $copy['body'][0]['note']);
    }

    public function testImportAcceptsNote(): void
    {
        ['auth' => $auth, 'base' => $base] = $this->prepare();

        $r = $this->req('POST', "$base/events/import", $auth, ['events' => [$this->event(['note' => 'Aus ICS']), $this->event(['name' => 'Ohne'])]]);
        $this->assertSame(201, $r['status'], $r['content']);
        $byName = array_column($this->req('GET', "$base/events", $auth)['body'], 'note', 'name');
        $this->assertSame('Aus ICS', $byName['Training']);
        $this->assertNull($byName['Ohne']);

        $p = $this->req('POST', "$base/events/import/preview", $auth, ['events' => [$this->event(['name' => 'X', 'note' => str_repeat('a', 2001)])]]);
        $this->assertSame(200, $p['status'], $p['content']);
        $this->assertSame('invalid', $p['body']['events'][0]['status']);
        $this->assertSame(422, $this->req('POST', "$base/events/import", $auth, ['events' => [$this->event(['note' => str_repeat('a', 2001)])]])['status']);
    }

    public function testNoteInIcsAndPublicFeed(): void
    {
        ['auth' => $auth, 'base' => $base, 'calId' => $calId] = $this->prepare();
        $note = "Zeile 1, mit Komma; Semikolon\\ Backslash\nZeile 2";
        $e = $this->req('POST', "$base/events", $auth, $this->event(['note' => $note, 'isDraft' => false]));
        $this->assertSame(201, $e['status'], $e['content']);
        $eventId = $e['body']['id'];

        $member = $this->req('GET', "$base/events.ics", $auth);
        $this->assertSame(200, $member['status']);
        $expected = 'DESCRIPTION:Zeile 1\, mit Komma\; Semikolon\\\\ Backslash\nZeile 2';
        $this->assertStringContainsString($expected, preg_replace('/\r\n[ \t]/', '', $member['content']));

        $calendar = self::$em->find(\App\Entity\Calendar::class, $calId);
        $feed = TestHelper::createFeed(self::$em, $calendar->getClub(), [$calendar], FeedVisibility::PUBLIC, 'Feed', 's');
        $feedId = $feed->getId();
        self::$client->request('GET', "/api/feed/$feedId/ics");
        $this->assertStringContainsString($expected, preg_replace('/\r\n[ \t]/', '', (string) self::$client->getResponse()->getContent()));

        self::$client->request('GET', "/api/feed/$feedId/events");
        $body = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertSame($note, $body['events'][0]['note']);
        self::$client->request('GET', "/api/feed/$feedId/events/$eventId");
        $body = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertSame($note, $body['event']['note']);
        $this->assertSame($note, self::$em->find(Event::class, $eventId)?->getNote());
    }
}
