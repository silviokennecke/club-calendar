<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Export\UserDataExportService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Peak memory of the user data export with many edited events and security events (run: phpunit --group performance).
 * The pieces are dropped as the response does; the peak must not grow with the number of rows.
 */
#[Group('performance')]
class UserDataExportPerformanceTest extends KernelTestCase
{
    /** @return array<string, array{int}> */
    public static function sizes(): array
    {
        return ['3x1000 events' => [1000], '3x4000 events' => [4000]];
    }

    #[DataProvider('sizes')]
    public function testPeakMemory(int $eventsPerClub): void
    {
        self::bootKernel(['debug' => false]);
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class));
        $conn = $em->getConnection();

        for ($k = 0; $k < 3; ++$k) {
            $club = TestHelper::createClub($em, $user, "Club $k");
            $calendar = TestHelper::createCalendar($em, $club);
            $conn->beginTransaction();
            for ($i = 0; $i < $eventsPerClub; ++$i) {
                $conn->insert('event', [
                    'id' => Uuid::v7()->toRfc4122(), 'calendar_id' => $calendar->getId(), 'name' => "Termin $i", 'date' => '2026-07-01',
                    'time_begin' => '18:00', 'time_end' => '20:00', 'is_all_day' => 0, 'is_draft' => 0,
                    'updated_at' => '2026-03-01 10:00:00', 'updated_by_id' => $user->getId(),
                ]);
            }
            $conn->commit();
        }
        $conn->beginTransaction();
        for ($i = 0; $i < $eventsPerClub * 3; ++$i) {
            $conn->insert('security_event', [
                'id' => Uuid::v7()->toRfc4122(), 'user_id' => $user->getId(), 'type' => 'login', 'method' => 'password', 'success' => 1, 'attempts' => 1,
                'ip' => '203.0.113.1', 'user_agent' => str_repeat('UA ', 100), 'created_at' => '2026-01-01 00:00:00',
            ]);
            $conn->insert('refresh_token', [
                'id' => Uuid::v7()->toRfc4122(), 'family_id' => Uuid::v7()->toRfc4122(), 'user_id' => $user->getId(), 'issued_at' => '2026-01-01 00:00:00',
                'expires_at' => '2026-02-01 00:00:00', 'family_expires_at' => '2026-03-01 00:00:00',
            ]);
        }
        $conn->commit();
        $userId = $user->getId();
        $em->clear();
        unset($user, $club, $calendar);
        gc_collect_cycles();
        $user = $em->find(\App\Entity\User::class, $userId);

        $service = $c->get(UserDataExportService::class);
        memory_reset_peak_usage();
        $base = memory_get_usage();
        $bytes = 0;
        foreach ($service->chunks($user) as $piece) {
            $bytes += strlen($piece);
        }
        $peak = memory_get_peak_usage() - $base;

        fwrite(STDERR, sprintf("\nUser export (%d rows per club): %.1f MB output, peak +%.1f MB\n", $eventsPerClub, $bytes / 1048576, $peak / 1048576));
        $this->assertGreaterThan($eventsPerClub * 3 * 100, $bytes);
        $this->assertLessThan(32 * 1048576, $peak);
    }
}
