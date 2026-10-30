<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Exception\RateLimitExceededException;
use App\Service\Map\MapAvailability;
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
        // Map service configured (fake providers below); the tests without a token replace this.
        $container->set(MapAvailability::class, new MapAvailability('pk.test'));
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
        $this->assertArrayNotHasKey('name', $r['body']['suggestions'][0]);
    }

    public function testSuggestRequiresAuth(): void
    {
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/map/geocode/suggest?q=test');
        $this->assertSame(401, $r['status']);
        $this->assertSame('missing_token', $r['body']['code']);
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

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
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

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $locationId = $create['body']['id'];

        static::getContainer()->set(\App\Service\Map\MapImageProviderInterface::class, $this->fakeImageProvider());

        $this->client->request('GET', "/api/map/image/location/$locationId");
        $response = $this->client->getResponse();

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('image/jpeg', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('public', $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('max-age=86400', $response->headers->get('Cache-Control'));
        $this->assertStringNotContainsString('immutable', $response->headers->get('Cache-Control'));
        $this->assertSame('"'.hash('sha256', 'FAKEJPEG').'"', $response->headers->get('ETag'));
        $this->assertSame('FAKEJPEG', $response->getContent());
    }

    public function testLocationImageWithVersionIsImmutableAndSupportsEtag(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth);
        $locationId = $create['body']['id'];
        static::getContainer()->set(\App\Service\Map\MapImageProviderInterface::class, $this->fakeImageProvider());

        $this->client->request('GET', "/api/map/image/location/$locationId?v=123");
        $response = $this->client->getResponse();
        $this->assertSame(200, $response->getStatusCode());
        $cc = (string) $response->headers->get('Cache-Control');
        $this->assertStringContainsString('max-age=2592000', $cc);
        $this->assertStringContainsString('s-maxage=2592000', $cc);
        $this->assertStringContainsString('immutable', $cc);
        $etag = $response->headers->get('ETag');
        $this->assertNotEmpty($etag);

        $this->client->request('GET', "/api/map/image/location/$locationId?v=123", server: ['HTTP_IF_NONE_MATCH' => $etag]);
        $response = $this->client->getResponse();
        $this->assertSame(304, $response->getStatusCode());
        $this->assertSame('', (string) $response->getContent());

        // Empty v counts as absent
        $this->client->request('GET', "/api/map/image/location/$locationId?v=");
        $this->assertStringNotContainsString('immutable', (string) $this->client->getResponse()->headers->get('Cache-Control'));

        // Other validator: full response again
        $this->client->request('GET', "/api/map/image/location/$locationId?v=123", server: ['HTTP_IF_NONE_MATCH' => '"other"']);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
    }

    public function testLocationImageReturns404WhenNoCoordinates(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
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

        $loc = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
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

        $create = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
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

    // --- no MAPBOX_TOKEN: 503 (image placeholder / problem body), access checks first ---

    private function withoutMapService(): void
    {
        // Fresh kernel (the data stays in the database): setUp() already set a configured MapAvailability.
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        static::getContainer()->set(MapAvailability::class, new MapAvailability(''));
        $failing = new class implements \App\Service\Map\MapImageProviderInterface, \App\Service\Map\GeocoderInterface {
            public function getImage(float $lng, float $lat, int $zoom, int $width, int $height): string
            {
                throw new \LogicException('map provider must not be called without a token');
            }

            public function suggest(string $query, ?float $proximityLat = null, ?float $proximityLng = null, int $limit = 6): array
            {
                throw new \LogicException('geocoder must not be called without a token');
            }

            public function reverse(float $lng, float $lat): ?\App\Service\Map\GeocodedAddress
            {
                throw new \LogicException('geocoder must not be called without a token');
            }
        };
        static::getContainer()->set(\App\Service\Map\MapImageProviderInterface::class, $failing);
        static::getContainer()->set(\App\Service\Map\GeocoderInterface::class, $failing);
    }

    private function assertPlaceholderImage(): void
    {
        $response = $this->client->getResponse();
        $this->assertSame(503, $response->getStatusCode());
        $this->assertSame('image/png', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $body = (string) $response->getContent();
        $this->assertStringStartsWith("\x89PNG\r\n\x1a\n", $body);
        $this->assertLessThan(30 * 1024, strlen($body));
        $this->assertSame(file_get_contents(dirname(__DIR__, 2).'/assets/map-unavailable.png'), $body);
    }

    public function testLocationImageWithoutTokenReturns503WithPlaceholderImage(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $located = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth)['body']['id'];
        $plain = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
            'name' => 'No Coords',
        ], $auth)['body']['id'];
        $this->withoutMapService();

        $this->client->request('GET', "/api/map/image/location/$located");
        $this->assertPlaceholderImage();

        // Unknown places and places without a position stay 404: the 503 does not reveal them
        $this->client->request('GET', "/api/map/image/location/$plain");
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());
        $this->client->request('GET', '/api/map/image/location/00000000-0000-0000-0000-000000000000');
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());
    }

    public function testEventImageWithoutTokenChecksDraftVisibilityBefore503(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $locationId = TestHelper::jsonRequest($this->client, 'POST', "/api/clubs/{$cal->getClub()->getId()}/locations", [
            'name' => 'Venue', 'latitude' => 48.137, 'longitude' => 11.575,
        ], $auth)['body']['id'];
        $eventId = TestHelper::jsonRequest($this->client, 'POST', "/api/calendars/{$cal->getId()}/events", [
            'name' => 'Test Event', 'date' => '2026-08-01',
            'timeBegin' => '10:00', 'timeEnd' => '11:00', 'locationId' => $locationId,
        ], $auth)['body']['id'];
        $this->withoutMapService();

        // Draft: not published, so not even the 503 placeholder
        $this->client->request('GET', "/api/map/image/event/$eventId");
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());
        $this->client->request('GET', '/api/map/image/event/00000000-0000-0000-0000-000000000000');
        $this->assertSame(404, $this->client->getResponse()->getStatusCode());

        TestHelper::jsonRequest($this->client, 'PATCH', "/api/calendars/{$cal->getId()}/events/$eventId", ['isDraft' => false], $auth);
        $this->client->request('GET', "/api/map/image/event/$eventId");
        $this->assertPlaceholderImage();
    }

    public function testGeocodingWithoutTokenReturns503Problem(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $this->withoutMapService();

        foreach (['/api/map/geocode/suggest?q=München', '/api/map/geocode/reverse?lat=48.137&lng=11.575'] as $url) {
            $r = TestHelper::jsonRequest($this->client, 'GET', $url, [], $auth);
            $this->assertSame(503, $r['status'], $url.' '.$r['content']);
            $this->assertSame('map_unavailable', $r['body']['code'], $url);
            $this->assertSame(503, $r['body']['status'], $url);
            $this->assertStringStartsWith('application/problem+json', (string) $this->client->getResponse()->headers->get('Content-Type'));

            // Authentication comes first
            $r = TestHelper::jsonRequest($this->client, 'GET', $url);
            $this->assertSame(401, $r['status'], $url);
        }
    }

    public function testMapboxProxyWithoutTokenReturns503Problem(): void
    {
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $this->withoutMapService();
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/mapbox/api.mapbox.com/styles/v1/mapbox/streets-v12', [], $auth);
        $this->assertSame(503, $r['status'], $r['content']);
        $this->assertSame('map_unavailable', $r['body']['code']);
    }

    public function testMapboxProxyRequiresSignIn(): void
    {
        // Anonymous: 401 before any validation (also for a disallowed host/path), tokens and upstream untouched.
        foreach ([
            '/api/mapbox/api.mapbox.com/styles/v1/mapbox/streets-v12',
            '/api/mapbox/evil.example.com/styles/v1/x',
            '/api/mapbox/api.mapbox.com/not/allowed/path',
        ] as $url) {
            $r = TestHelper::jsonRequest($this->client, 'GET', $url);
            $this->assertSame(401, $r['status'], $url);
            $this->assertSame('missing_token', $r['body']['code'], $url);
        }

        // Signed in: reaches the proxy (validation answers, not 401)
        ['user' => $user] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $r = TestHelper::jsonRequest($this->client, 'GET', '/api/mapbox/evil.example.com/styles/v1/x', [], $auth);
        $this->assertSame(400, $r['status'], $r['content']);
    }
}
