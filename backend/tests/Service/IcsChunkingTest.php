<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\Calendar;
use App\Enum\FeedVisibility;
use App\Ics\IcsEventReader;
use App\Repository\HolidayEventRepository;
use App\Service\EventExportService;
use App\Service\IcsService;
use App\Service\PublicFeedService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Chunked reading must give the same ICS text as one big chunk, for every chunk size and cap. */
class IcsChunkingTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private string $feedId;
    private string $calendarId;

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $user = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class));
        $club = TestHelper::createClub($this->em, $user);
        $calendar = TestHelper::createCalendar($this->em, $club);
        $this->feedId = TestHelper::createFeed($this->em, $club, [$calendar], FeedVisibility::PUBLIC)->getId();
        $this->calendarId = $calendar->getId();
        $this->em->flush();
    }

    /** Events 1..7: several share date and start time (keyset tie-break by id), one spans zones. */
    private function seed(int $count = 7): void
    {
        $calendar = $this->em->find(Calendar::class, $this->calendarId);
        for ($i = 1; $i <= $count; ++$i) {
            $e = TestHelper::createEvent($this->em, $calendar, [
                'name' => "Termin $i",
                'date' => '2026-03-'.str_pad((string) (10 + intdiv($i, 3)), 2, '0', STR_PAD_LEFT),
                'timeBegin' => 0 === $i % 2 ? '18:00' : '09:00',
                'timeEnd' => '20:00',
                'isDraft' => false,
            ]);
            if (5 === $i) {
                $e->setTimezone('Asia/Tokyo');
            }
        }
        $this->em->flush();
        $this->em->clear();
    }

    private function feed(int $chunkSize, int $max): string
    {
        $c = static::getContainer();
        $service = new PublicFeedService(
            $this->em,
            $c->get(IcsService::class),
            new IcsEventReader($this->em, $chunkSize),
            $c->get(HolidayEventRepository::class),
            $c->get('request_stack'),
            false,
            180,
            24,
            $max,
        );

        return $this->normalize(implode('', iterator_to_array($service->streamFeedIcs($service->prepareFeedIcs($this->feedId, null, null)), false)));
    }

    private function export(int $chunkSize): string
    {
        $c = static::getContainer();
        $service = new EventExportService($this->em, $c->get(\App\Service\CalendarReferences::class), $c->get(IcsService::class), new IcsEventReader($this->em, $chunkSize));
        $calendar = $this->em->find(Calendar::class, $this->calendarId);

        return $this->normalize(implode('', iterator_to_array($service->export($calendar, null, null, 'true', null), false)));
    }

    private function normalize(string $ics): string
    {
        return preg_replace('/^DTSTAMP:.*$/m', 'DTSTAMP:X', $ics);
    }

    public function testEveryChunkSizeGivesTheSameOutput(): void
    {
        $this->seed();
        $reference = $this->feed(500, 0);
        $this->assertSame(7, substr_count($reference, 'BEGIN:VEVENT'));
        $this->assertSame(2, substr_count($reference, 'BEGIN:VTIMEZONE'));
        foreach ([1, 2, 3, 6, 7, 8] as $size) {
            $this->assertSame($reference, $this->feed($size, 0), "feed, chunk size $size");
        }
        $exportReference = $this->export(500);
        foreach ([1, 3, 7] as $size) {
            $this->assertSame($exportReference, $this->export($size), "export, chunk size $size");
        }
    }

    public function testCapAppliesAcrossChunks(): void
    {
        $this->seed();
        foreach ([[3, 4], [3, 6], [3, 1], [2, 5], [7, 7], [1, 3], [4, 100]] as [$size, $max]) {
            $expected = $this->feed(500, $max);
            $this->assertSame(min($max, 7), substr_count($expected, 'BEGIN:VEVENT'));
            $this->assertSame($expected, $this->feed($size, $max), "chunk $size, cap $max");
        }
        // the cap keeps the first events by date and time
        $this->assertStringContainsString('SUMMARY:Termin 1', $this->feed(2, 1));
    }

    public function testChunkBoundaries(): void
    {
        $this->seed(6);
        $c = static::getContainer();
        $qb = fn () => $this->em->createQueryBuilder()->select('e')->from(\App\Entity\Event::class, 'e');
        $sizes = fn (int $chunk, ?int $limit) => array_map('count', iterator_to_array((new IcsEventReader($this->em, $chunk))->chunks($qb(), $limit), false));
        $this->assertSame([3, 3], $sizes(3, null));
        $this->assertSame([3, 2], $sizes(3, 5));
        $this->assertSame([6], $sizes(6, null));
        $this->assertSame([4, 2], $sizes(4, null));
        $this->assertSame([], $sizes(3, 0));
    }

    public function testEmptyResultIsAValidCalendar(): void
    {
        foreach ([$this->feed(3, 0), $this->export(3)] as $ics) {
            $this->assertSame("BEGIN:VCALENDAR\r\nPRODID:-//eluceo/ical//2.0/EN\r\nVERSION:2.0\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n", $ics);
        }
    }

    public function testStreamErrorIsLoggedAndEndsOutput(): void
    {
        $logger = new class extends \Psr\Log\AbstractLogger {
            /** @var list<string> */
            public array $messages = [];

            public function log($level, \Stringable|string $message, array $context = []): void
            {
                $this->messages[] = (string) $message;
            }
        };
        $service = new IcsService($logger);
        $broken = (function () {
            yield 'BEGIN:VCALENDAR'."\r\n";
            throw new \RuntimeException('db gone');
        })();
        ob_start();
        $service->outputCallback($broken)();
        $out = (string) ob_get_clean();
        $this->assertSame("BEGIN:VCALENDAR\r\n", $out);
        $this->assertSame(['ICS stream aborted'], $logger->messages);
    }
}
