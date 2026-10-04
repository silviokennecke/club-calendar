<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Service\HolidayCalendarService;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;

/**
 * The holiday feed URL comes from users: the configured service must not reach private or loopback
 * addresses. assertSafeUrl() cannot read bracketed IPv6 hosts; redirects are checked by the same
 * NoPrivateNetworkHttpClient (config/services.yaml).
 */
class HolidayCalendarServiceTest extends KernelTestCase
{
    /**
     * @return iterable<string, array{string}>
     */
    public static function privateTargets(): iterable
    {
        yield 'IPv6 loopback' => ['http://[::1]:9/ferien.ics'];
        yield 'IPv4-mapped loopback' => ['http://[::ffff:127.0.0.1]:9/ferien.ics'];
        yield 'IPv6 unique local' => ['http://[fd00::1]:9/ferien.ics'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('privateTargets')]
    public function testRefusesPrivateNetworkTargets(string $url): void
    {
        $service = static::getContainer()->get(HolidayCalendarService::class);

        try {
            $service->fetchAndStore(new HolidayCalendar(new Calendar(), 'Ferien', $url));
            $this->fail('private target was requested');
        } catch (TransportExceptionInterface $e) {
            $this->assertStringContainsString('is blocked for', $e->getMessage());
        }
    }
}
