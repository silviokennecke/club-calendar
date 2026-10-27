<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Pdf\PdfExportService;
use App\Pdf\PdfLayout;
use App\Pdf\PdfOptions;
use App\Service\EventExportService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Peak memory, time and size of the PDF export for a full year (run: phpunit --group performance). Run single cases
 * with --filter: a PHP fatal (memory) ends the process. Wall times on a loaded dev machine are noisy; judge them in the image.
 * The route limits are applied (512M, 60 s); the pass criteria are peak below the limit with headroom and < ~20 s.
 */
#[Group('performance')]
class PdfPerformanceTest extends KernelTestCase
{
    private const int YEAR = 2026;

    /** @return iterable<string, array{int, int, PdfLayout, string}> events, days the events are spread over, layout, paper */
    public static function cases(): iterable
    {
        $datasets = ['1000 events/365 days' => [1000, 365], '2000 events/365 days' => [2000, 365], '2000 events/45 days' => [2000, 45]];
        foreach ($datasets as $name => [$events, $spread]) {
            foreach (PdfLayout::cases() as $layout) {
                foreach (['a4', 'a3'] as $paper) {
                    yield "$name $layout->value $paper" => [$events, $spread, $layout, $paper];
                }
            }
        }
    }

    #[DataProvider('cases')]
    public function testRender(int $events, int $spread, PdfLayout $layout, string $paper): void
    {
        ini_set('memory_limit', '512M');
        set_time_limit(60);
        self::bootKernel(['debug' => false]);
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class));
        $club = TestHelper::createClub($em, $user);
        $calendar = TestHelper::createCalendar($em, $club);
        $loc = TestHelper::createLocation($em, $club, 'Schützenhalle');
        $props = [TestHelper::createProperty($em, $calendar, 'Tracht', '🎯'), TestHelper::createProperty($em, $calendar, 'Fest', '🎉'), TestHelper::createProperty($em, $calendar, 'Familie', '👨‍👩‍👧')];
        $feat = TestHelper::createFeature($em, $calendar);
        $group = TestHelper::createTargetGroup($em, $club);

        $conn = $em->getConnection();
        $conn->beginTransaction();
        for ($i = 0; $i < $events; ++$i) {
            $id = Uuid::v7()->toRfc4122();
            $conn->insert('event', [
                'id' => $id, 'calendar_id' => $calendar->getId(), 'location_id' => $loc->getId(),
                'name' => "Vereinsabend und Training Nummer $i",
                'date' => (new \DateTimeImmutable(self::YEAR.'-01-01'))->modify('+'.($i % $spread).' days')->format('Y-m-d'),
                'time_begin' => sprintf('%02d:00', 8 + $i % 12), 'time_end' => sprintf('%02d:30', 9 + $i % 12), 'is_all_day' => 0, 'is_draft' => 0,
                'note' => 'Notiz '.$i, 'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $conn->insert('event_property', ['event_id' => $id, 'property_id' => $props[$i % 3]->getId()]);
            $conn->insert('event_feature', ['event_id' => $id, 'feature_id' => $feat->getId()]);
            $conn->insert('event_target_group', ['event_id' => $id, 'target_group_id' => $group->getId()]);
        }
        $conn->commit();
        $calendarId = $calendar->getId();
        $userId = $user->getId();
        $em->clear();
        gc_collect_cycles();

        $service = $c->get(PdfExportService::class);
        $cal = $em->find(\App\Entity\Calendar::class, $calendarId);
        $u = $em->find(\App\Entity\User::class, $userId);
        $filter = $c->get(EventExportService::class)->filter($cal, self::YEAR.'-01-01', self::YEAR.'-12-31', null, null);
        memory_reset_peak_usage();
        $t = microtime(true);
        $pdf = $service->render($cal, $filter, new PdfOptions($layout, $paper), $u);
        $seconds = microtime(true) - $t;
        $peak = memory_get_peak_usage(true);
        $this->assertStringStartsWith('%PDF', $pdf);
        fwrite(STDERR, sprintf("\nPDF %d events/%d days %s %s: %.1f s, peak %.1f MB, %.2f MB pdf\n", $events, $spread, $layout->value, $paper, $seconds, $peak / 1048576, \strlen($pdf) / 1048576));
        $this->assertLessThan(20.0, $seconds);
        $this->assertLessThan(0.75 * 512 * 1048576, $peak);
    }
}
