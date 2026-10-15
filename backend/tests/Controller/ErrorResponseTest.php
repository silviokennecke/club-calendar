<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Error responses must carry the CORS headers (otherwise the browser only sees a network error)
 * and must not expose internal class names or URLs.
 */
class ErrorResponseTest extends WebTestCase
{
    private const string ORIGIN = 'http://localhost:5173';

    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static string $auth;
    private static string $calendarId;
    private static string $foreignCalendarId;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        $hasher = $container->get(UserPasswordHasherInterface::class);
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub(self::$em, $hasher);
        ['calendar' => $foreign] = TestHelper::createCalendarWithClub(self::$em, $hasher);
        self::$auth = TestHelper::authHeader($user, $container->get(TokenService::class));
        self::$calendarId = $cal->getId();
        self::$foreignCalendarId = $foreign->getId();
    }

    /**
     * @return iterable<string, array{string, string, int, bool}>
     */
    public static function errorRequests(): iterable
    {
        yield 'unknown calendar (MapEntity)' => ['GET', '/api/calendars/unknown-id/events/x', 404, true];
        yield 'unknown club (MapEntity)' => ['GET', '/api/clubs/unknown-id', 404, true];
        // Without a token every club/calendar route is 401 before the id is looked up (no probing of ids)
        yield 'unknown club without token' => ['GET', '/api/clubs/unknown-id', 401, false];
        yield 'unknown route' => ['GET', '/api/does-not-exist', 404, true];
        yield 'method not allowed' => ['PUT', '/api/clubs', 405, true];
        yield 'foreign calendar' => ['GET', '/api/calendars/{foreign}/events', 403, true];
        yield 'unknown event' => ['GET', '/api/calendars/{own}/events/unknown-id', 404, true];
        yield 'invalid json' => ['POST', '/api/calendars/{own}/events', 400, true];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('errorRequests')]
    public function testErrorResponsesCarryCorsHeadersAndNoInternals(string $method, string $uri, int $status, bool $withAuth): void
    {
        $uri = str_replace(['{own}', '{foreign}'], [self::$calendarId, self::$foreignCalendarId], $uri);
        $headers = ['HTTP_ORIGIN' => self::ORIGIN, 'CONTENT_TYPE' => 'application/json'];
        if ($withAuth) {
            $headers['HTTP_AUTHORIZATION'] = self::$auth;
        }
        self::$client->request($method, $uri, [], [], $headers, 'POST' === $method ? '{nope' : null);
        $response = self::$client->getResponse();

        $this->assertSame($status, $response->getStatusCode());
        $this->assertSame(self::ORIGIN, $response->headers->get('Access-Control-Allow-Origin'));
        $detail = (string) (json_decode((string) $response->getContent(), true)['detail'] ?? '');
        $this->assertNotSame('', $detail);
        foreach (['App\\', 'Symfony\\', 'EntityValueResolver', 'localhost', '/api/'] as $internal) {
            $this->assertStringNotContainsString($internal, $detail);
        }
    }
}
