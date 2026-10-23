<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Enum\FeedVisibility;
use App\Service\EventExportService;
use App\Service\PublicFeedService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

/** Peak memory of the ICS read path with 5000 events and assignments (run: phpunit --group performance). */
#[Group('performance')]
class IcsMemoryTest extends KernelTestCase
{
    private const EVENTS = 5000;

    public function testPeakMemory(): void
    {
        self::bootKernel();
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
        for ($i = 0; $i < self::EVENTS; ++$i) {
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
        $ics = $service->renderFeedIcs($service->prepareFeedIcs($feedId, null, null));
        $feedPeak = memory_get_peak_usage() - $base;
        $this->assertGreaterThan(self::EVENTS, substr_count($ics, 'BEGIN:VEVENT') + 1);
        unset($ics);

        $em->clear();
        gc_collect_cycles();
        memory_reset_peak_usage();
        $base = memory_get_usage();
        $calendar = $em->find(\App\Entity\Calendar::class, $calendarId);
        $ics = $c->get(EventExportService::class)->export($calendar, null, null, 'true', null);
        $exportPeak = memory_get_peak_usage() - $base;
        $this->assertGreaterThan(self::EVENTS, substr_count($ics, 'BEGIN:VEVENT') + 1);

        fwrite(STDERR, sprintf("\nICS peak memory (%d events): feed %.1f MB, export %.1f MB\n", self::EVENTS, $feedPeak / 1048576, $exportPeak / 1048576));
    }
}
