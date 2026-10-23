<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Enum\FeedVisibility;
use App\Service\EventExportService;
use App\Service\PublicFeedService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Peak memory of the streamed ICS output with 5000 and 20000 events and assignments (run: phpunit --group performance).
 * The pieces are counted and dropped, as the response does; the peak must not grow with the number of events.
 */
#[Group('performance')]
class IcsMemoryTest extends KernelTestCase
{
    /** @return array<string, array{int}> */
    public static function sizes(): array
    {
        return ['5000 events' => [5000], '20000 events' => [20000]];
    }

    #[DataProvider('sizes')]
    public function testPeakMemory(int $events): void
    {
        self::bootKernel(['debug' => false]); // prod-like: the debug query collector would keep every parameter list
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class));
        $club = TestHelper::createClub($em, $user);
        $calendar = TestHelper::createCalendar($em, $club);
        $feed = TestHelper::createFeed($em, $club, [$calendar], FeedVisibility::PUBLIC);
        $loc = TestHelper::createLocation($em, $club, 'Halle');
        $props = [TestHelper::createProperty($em, $calendar, 'A', '🎯'), TestHelper::createProperty($em, $calendar, 'B', '🎉')];
        $feat = TestHelper::createFeature($em, $calendar);
        $group = TestHelper::createTargetGroup($em, $club);

        $conn = $em->getConnection();
        $conn->beginTransaction();
        for ($i = 0; $i < $events; ++$i) {
            $id = Uuid::v7()->toRfc4122();
            $conn->insert('event', [
                'id' => $id, 'calendar_id' => $calendar->getId(), 'location_id' => $loc->getId(), 'name' => "Termin $i",
                'date' => (new \DateTimeImmutable('today'))->modify('+'.($i % 600).' days')->format('Y-m-d'),
                'time_begin' => '18:00', 'time_end' => '20:00', 'is_all_day' => 0, 'is_draft' => 0, 'note' => 'Notiz '.$i,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);
            foreach ($props as $p) {
                $conn->insert('event_property', ['event_id' => $id, 'property_id' => $p->getId()]);
            }
            $conn->insert('event_feature', ['event_id' => $id, 'feature_id' => $feat->getId()]);
            $conn->insert('event_target_group', ['event_id' => $id, 'target_group_id' => $group->getId()]);
        }
        $conn->commit();
        $feedId = $feed->getId();
        $calendarId = $calendar->getId();
        $em->clear();
        unset($user, $club, $calendar, $feed, $loc, $props, $feat, $group);
        gc_collect_cycles();

        $service = $c->get(PublicFeedService::class);
        memory_reset_peak_usage();
        $base = memory_get_usage();
        $count = $this->countEvents($service->streamFeedIcs($service->prepareFeedIcs($feedId, null, null)));
        $feedPeak = memory_get_peak_usage() - $base;
        $this->assertSame($events, $count);

        $em->clear();
        gc_collect_cycles();
        memory_reset_peak_usage();
        $base = memory_get_usage();
        $calendar = $em->find(\App\Entity\Calendar::class, $calendarId);
        $count = $this->countEvents($c->get(EventExportService::class)->export($calendar, null, null, 'true', null));
        $exportPeak = memory_get_peak_usage() - $base;
        $this->assertSame($events, $count);

        fwrite(STDERR, sprintf("\nICS peak memory (%d events): feed %.1f MB, export %.1f MB\n", $events, $feedPeak / 1048576, $exportPeak / 1048576));
    }

    /** @param iterable<string> $pieces */
    private function countEvents(iterable $pieces): int
    {
        $n = 0;
        foreach ($pieces as $piece) {
            $n += substr_count($piece, 'BEGIN:VEVENT');
        }

        return $n;
    }
}
