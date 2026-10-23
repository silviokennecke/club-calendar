<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Event;
use App\Entity\EventFeature;
use App\Entity\EventProperty;
use App\Entity\EventTargetGroup;
use App\Enum\FeedVisibility;
use App\Repository\HolidayEventRepository;
use App\Service\EventExportService;
use App\Service\IcsService;
use App\Service\PublicFeedService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** The ICS text of feed and member export must stay byte-identical (only the random event UIDs are normalized). */
class IcsGoldenTest extends KernelTestCase
{
    private EntityManagerInterface $em;

    public function testFeedAndExportMatchReference(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);

        $user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $club = TestHelper::createClub($this->em, $user);
        $calendar = TestHelper::createCalendar($this->em, $club);
        $calendar->setTimezone('America/New_York');
        $this->em->flush();
        $other = TestHelper::createCalendar($this->em, $club, 'Other');

        $geo = TestHelper::createLocation($this->em, $club, 'Schützenhaus; "Süd": Halle');
        $geo->setStreet('Hauptstr. 1, Hinterhof')->setZip('12345')->setCity('Köln')->setCountry('DE');
        $geo->setLatitude(50.9375)->setLongitude(6.9603);
        $plain = TestHelper::createLocation($this->em, $club, 'Vereinsheim');
        $badGeo = TestHelper::createLocation($this->em, $club, 'Nirgendwo');
        $badGeo->setLatitude(123.0)->setLongitude(6.0);
        $streetOnly = (new \App\Entity\Location())->setClub($club)->setStreet('Nur Straße 5');
        $this->em->persist($streetOnly);
        $this->em->flush();

        $p1 = TestHelper::createProperty($this->em, $calendar, 'Tracht', '🎯');
        $p2 = TestHelper::createProperty($this->em, $calendar, 'Ohne Icon');
        $p3 = TestHelper::createProperty($this->em, $calendar, 'Fest', '🎉');
        $f1 = TestHelper::createFeature($this->em, $calendar, 'Bonusschießen');
        $f2 = TestHelper::createFeature($this->em, $calendar, 'Grillen, Bier');
        $t1 = TestHelper::createTargetGroup($this->em, $club, 'Jugend');
        $t2 = TestHelper::createTargetGroup($this->em, $club, 'Erwachsene');

        $mk = function (string $name, string $date, array $o = []) use ($calendar): Event {
            $e = TestHelper::createEvent($this->em, $calendar, ['name' => $name, 'date' => $date, 'isDraft' => $o['draft'] ?? false, 'timeBegin' => $o['b'] ?? '18:00', 'timeEnd' => $o['e'] ?? '20:00']);
            isset($o['end']) && $e->setDateEnd(new \DateTimeImmutable($o['end']));
            isset($o['tz']) && $e->setTimezone($o['tz']);
            isset($o['allDay']) && $e->setIsAllDay(true);
            isset($o['note']) && $e->setNote($o['note']);
            isset($o['loc']) && $e->setLocation($o['loc']);
            $this->em->flush();

            return $e;
        };
        $assign = function (Event $e, array $props = [], array $feats = [], array $groups = []): void {
            foreach ($props as $p) {
                $x = (new EventProperty())->setEvent($e)->setProperty($p);
                $this->em->persist($x);
            }
            foreach ($feats as $f) {
                $this->em->persist((new EventFeature())->setEvent($e)->setFeature($f));
            }
            foreach ($groups as $g) {
                $this->em->persist((new EventTargetGroup())->setEvent($e)->setTargetGroup($g));
            }
            $this->em->flush();
        };

        $assign($mk('Training Ä/Ö/ü ß, mit; Sonderzeichen: \\ "x"', '2026-03-10', ['loc' => $geo, 'note' => "Zeile eins\nZeile zwei, mit Komma; und Semikolon\r\nLange Zeile ".str_repeat('äöü Wort ', 30)]), [$p1, $p2, $p3], [$f1, $f2], [$t1, $t2]);
        $assign($mk('Zwei-Tages Lager', '2026-03-12', ['end' => '2026-03-14', 'tz' => 'Europe/London', 'loc' => $plain]), [$p3]);
        $assign($mk('Ganztägig', '2026-03-15', ['allDay' => true, 'note' => 'nur Notiz']), [], [], [$t1]);
        $assign($mk('Ganztägig mehrtägig', '2026-03-16', ['allDay' => true, 'end' => '2026-03-18', 'loc' => $streetOnly]), [], [$f2]);
        $assign($mk('Ungültige Geo', '2026-03-20', ['loc' => $badGeo, 'tz' => 'Asia/Tokyo']));
        $assign($mk('Ohne Ort, gleiche Zeit A', '2026-03-21', ['b' => '09:00', 'e' => '09:00']));
        $assign($mk('Ohne Ort, gleiche Zeit B', '2026-03-21', ['b' => '09:00', 'e' => '10:30', 'tz' => 'Mist/Zone']));
        $assign($mk('Über Mitternacht', '2026-03-22', ['b' => '22:00', 'e' => '02:00', 'end' => '2026-03-23', 'tz' => 'UTC']), [$p1]);
        $assign($mk('Entwurf', '2026-03-25', ['draft' => true, 'loc' => $geo, 'note' => 'geheim']), [$p1], [$f1], [$t2]);
        $mk('Anderes Datum Sommerzeit', '2026-07-01', ['tz' => 'Europe/Berlin']);
        $mk('Ungültige Zeit', '2026-03-27', ['b' => 'xx:yy']);

        $otherEvent = TestHelper::createEvent($this->em, $other, ['name' => 'Fremd', 'date' => '2026-03-11', 'isDraft' => false]);
        unset($otherEvent);

        $calendarId = $calendar->getId();
        $groupId = $t1->getId();
        $feed = TestHelper::createFeed($this->em, $club, [$calendar], FeedVisibility::PUBLIC);
        // assignments were persisted without touching the inverse collections: reload everything
        $this->em->clear();
        $calendar = $this->em->find(\App\Entity\Calendar::class, $calendarId);
        $service = new PublicFeedService($this->em, $c->get(IcsService::class), $c->get(\App\Ics\IcsEventReader::class), $c->get(HolidayEventRepository::class), $c->get('request_stack'), false);
        $plan = $service->prepareFeedIcs($feed->getId(), null, null);
        $outputs = [
            'feed' => implode('', iterator_to_array($service->streamFeedIcs($plan), false)),
            'export_published' => implode('', iterator_to_array($c->get(EventExportService::class)->export($calendar, null, null, null, null), false)),
            'export_drafts' => implode('', iterator_to_array($c->get(EventExportService::class)->export($calendar, null, null, 'true', null), false)),
            'export_filtered' => implode('', iterator_to_array($c->get(EventExportService::class)->export($calendar, '2026-03-11', '2026-03-21', 'true', $groupId), false)),
        ];

        $actual = '';
        foreach ($outputs as $name => $ics) {
            $n = 0;
            $ics = preg_replace('/^DTSTAMP:.*$/m', 'DTSTAMP:X', $ics);
            $ics = preg_replace_callback('/event-[0-9a-f-]{36}@/', static function () use (&$n) { return 'event-N'.++$n.'@'; }, $ics);
            $actual .= "=== $name ===\n".$ics."\n";
        }

        $file = __DIR__.'/fixtures/ics-golden.txt';
        if (!is_file($file) || '1' === getenv('UPDATE_GOLDEN')) {
            file_put_contents($file, $actual);
        }
        $this->assertSame(file_get_contents($file), $actual);
    }
}
