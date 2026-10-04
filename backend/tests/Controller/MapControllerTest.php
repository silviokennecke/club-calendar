<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Exception\RateLimitExceededException;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class MapControllerTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private UserPasswordHasherInterface $hasher;
    private TokenService $tokens;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = static::getContainer();
        $this->em = $container->get(EntityManagerInterface::class);
        $this->hasher = $container->get(UserPasswordHasherInterface::class);
        $this->tokens = $container->get(TokenService::class);
        DatabaseResetter::reset($this->em);
    }

    public function testSuggestReturnsNormalizedResults(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $fakeGeocoder = new class implements \App\Service\Map\GeocoderInterface {
            public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
            {
                return [new \App\Service\Map\SuggestionResult('München Hbf', 48.14, 11.56, 'Bahnhofplatz', '80335', 'München', 'Germany')];
            }

            public function reverse(float $lng, float $lat): ?\App\Service\Map\GeocodedAddress
            {
                return null;
            }
        };
        static::getContainer()->set(\App\Service\Map\GeocoderInterface::class, $fakeGeocoder);

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/suggest?q=München+Hbf', [], $auth);

        $this->assertSame(200, $r['status']);
        $this->assertArrayHasKey('suggestions', $r['body']);
        $this->assertCount(1, $r['body']['suggestions']);
        $this->assertSame('München Hbf', $r['body']['suggestions'][0]['label']);
        $this->assertSame(48.14, $r['body']['suggestions'][0]['lat']);
    }

    public function testSuggestRequiresAuth(): void
    {
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/suggest?q=test');
        $this->assertSame(403, $r['status']);
    }

    public function testSuggestReturnsEmptyArrayWhenQueryBlank(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/suggest?q=', [], $auth);
        $this->assertSame(200, $r['status']);
        $this->assertSame([], $r['body']['suggestions']);
    }

    public function testReverseReturnsAddress(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $fakeGeocoder = new class implements \App\Service\Map\GeocoderInterface {
            public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
            {
                return [];
            }

            public function reverse(float $lng, float $lat): ?\App\Service\Map\GeocodedAddress
            {
                return new \App\Service\Map\GeocodedAddress('Marienplatz, München', 'Marienplatz', '80331', 'München', 'Germany');
            }
        };
        static::getContainer()->set(\App\Service\Map\GeocoderInterface::class, $fakeGeocoder);

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/reverse?lat=48.137&lng=11.575', [], $auth);

        $this->assertSame(200, $r['status']);
        $this->assertSame('Marienplatz, München', $r['body']['label']);
        $this->assertSame('München', $r['body']['city']);
    }

    public function testReverseReturns404WhenNoResult(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $fakeGeocoder = new class implements \App\Service\Map\GeocoderInterface {
            public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
            {
                return [];
            }

            public function reverse(float $lng, float $lat): ?\App\Service\Map\GeocodedAddress
            {
                return null;
            }
        };
        static::getContainer()->set(\App\Service\Map\GeocoderInterface::class, $fakeGeocoder);

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/reverse?lat=0&lng=0', [], $auth);
        $this->assertSame(404, $r['status']);
    }

    public function testLocationSerializeIncludesUpdatedAt(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/locations", [
            'name' => 'Test Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $this->assertSame(201, $create['status']);
        $this->assertArrayHasKey('updatedAt', $create['body']);
        $this->assertIsInt($create['body']['updatedAt']);
        $this->assertGreaterThan(0, $create['body']['updatedAt']);
    }

    private function fakeImageProvider(): \App\Service\Map\MapImageProviderInterface
    {
        return new class implements \App\Service\Map\MapImageProviderInterface {
            public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string
            {
                return 'FAKEJPEG';
            }
        };
    }

    public function testLocationImageReturnsJpeg(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $locationId = $create['body']['id'];

        static::getContainer()->set(\App\Service\Map\MapImageProviderInterface::class, $this->fakeImageProvider());

        $this->client->request('GET', "/api/map/image/location/$locationId");
        $response = $this->client->getResponse();

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('image/jpeg', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('public', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('max-age=3600', $response->headers->get('Cache-Control'));
        $this->assertSame('FAKEJPEG', $response->getContent());
    }

    public function testLocationImageReturns404WhenNoCoordinates(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/locations", [
            'name' => 'No Coords',
        ], $auth);
        $locationId = $create['body']['id'];

        $this->client->request('GET', "/api/map/image/location/$locationId");
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());
    }

    public function testLocationImageReturns404ForUnknownId(): void
    {
        $this->client->request('GET', '/api/map/image/location/00000000-0000-0000-0000-000000000000');
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());
    }

    public function testEventImageReturnsJpeg(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $loc = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $locationId = $loc['body']['id'];

        $ev = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/events", [
            'name' => 'Test Event', 'date' => '2026-08-01',
            'timeBegin' => '10:00', 'timeEnd' => '11:00', 'locationId' => $locationId,
        ], $auth);
        $eventId = $ev['body']['id'];

        static::getContainer()->set(\App\Service\Map\MapImageProviderInterface::class, $this->fakeImageProvider());

        // New events are drafts: not published, so the public endpoint does not know them
        $this->client->request('GET', "/api/map/image/event/$eventId");
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());

        TestHelper::jsonRequest($this->client, 'PATCH', "/api/calendars/{$cal->getId()}/events/$eventId", ['isDraft' => false], $auth);
        $this->client->request('GET', "/api/map/image/event/$eventId");
        $response = $this->client->getResponse();

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('image/jpeg', $response->headers->get('Content-Type'));
        $this->assertSame('FAKEJPEG', $response->getContent());
    }

    public function testSuggestReturns429WhenRateLimitExceeded(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        static::getContainer()->set(\App\Service\Map\GeocoderInterface::class, new class implements \App\Service\Map\GeocoderInterface {
            public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
            {
                throw new RateLimitExceededException();
            }

            public function reverse(float $lng, float $lat): ?\App\Service\Map\GeocodedAddress
            {
                return null;
            }
        });

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/suggest?q=München', [], $auth);
        $this->assertSame(429, $r['status']);
    }

    public function testReverseReturns429WhenRateLimitExceeded(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        static::getContainer()->set(\App\Service\Map\GeocoderInterface::class, new class implements \App\Service\Map\GeocoderInterface {
            public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
            {
                return [];
            }

            public function reverse(float $lng, float $lat): ?\App\Service\Map\GeocodedAddress
            {
                throw new RateLimitExceededException();
            }
        });

        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/reverse?lat=48.137&lng=11.575', [], $auth);
        $this->assertSame(429, $r['status']);
    }

    public function testLocationImageReturns429WhenRateLimitExceeded(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $locationId = $create['body']['id'];

        static::getContainer()->set(\App\Service\Map\MapImageProviderInterface::class, new class implements \App\Service\Map\MapImageProviderInterface {
            public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string
            {
                throw new RateLimitExceededException();
            }
        });

        $this->client->request('GET', "/api/map/image/location/$locationId");
        $this->assertSame(429, $this->client->getResponse()->getStatusCode());
    }
}
