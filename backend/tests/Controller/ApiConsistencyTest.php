<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\ClubUser;
use App\Entity\HolidayCalendar;
use App\Service\Map\MapAvailability;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Lexik\Bundle\JWTAuthenticationBundle\Encoder\JWTEncoderInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Consistent API answers: 401 (not 403) without a token, RFC 7807 bodies with a stable `code` for every
 * error (JWT, login, holiday calendars, Mapbox proxy, OAuth start), codes on all 400s, partial PATCH and
 * `200 {ok: true}` DELETE of holiday calendars, GET-only Mapbox proxy, members without no-op successes.
 */
class ApiConsistencyTest extends WebTestCase
{
    private const UNKNOWN_ID = '01900000-0000-7000-8000-000000000000';

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

    /** @param array<string, mixed> $expected subset of the body */
    private function assertProblem(int $status, array $expected, array $r): void
    {
        $this->assertSame($status, $r['status'], $r['content']);
        $this->assertStringStartsWith('application/problem+json', $r['headers']['content-type'][0] ?? '', $r['content']);
        $this->assertIsArray($r['body'], $r['content']);
        foreach (['type', 'title', 'status', 'detail'] as $member) {
            $this->assertArrayHasKey($member, $r['body'], $r['content']);
        }
        $this->assertSame($status, $r['body']['status']);
        foreach ($expected as $key => $value) {
            $this->assertSame($value, $r['body'][$key] ?? null, "$key in ".$r['content']);
        }
    }

    private function req(string $method, string $uri, string $auth = '', array $body = []): array
    {
        return TestHelper::jsonRequest($this->client, $method, $uri, $body, $auth);
    }

    // --- 1. no token: 401 on membership-guarded routes ---

    public function testMissingTokenIs401OnGuardedRoutesAndNon403(): void
    {
        ['user' => $user, 'club' => $club, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $stranger = TestHelper::createUser($this->em, $this->hasher);

        foreach ([
            ['GET', '/api/clubs'],
            ['GET', "/api/clubs/{$club->getId()}"],
            ['GET', '/api/clubs/'.self::UNKNOWN_ID],
            ['DELETE', "/api/clubs/{$club->getId()}/members/{$user->getId()}"],
            ['GET', "/api/clubs/{$club->getId()}/calendars"],
            ['GET', "/api/calendars/{$cal->getId()}/events"],
            ['GET', '/api/calendars/'.self::UNKNOWN_ID.'/events'],
            ['GET', "/api/calendars/{$cal->getId()}/holiday-calendars"],
            ['GET', '/api/map/geocode/suggest?q=Berlin'],
            ['GET', '/api/map/geocode/reverse?lat=1&lng=2'],
            ['GET', '/api/auth/me'],
        ] as [$method, $uri]) {
            $r = $this->req($method, $uri);
            $this->assertSame(401, $r['status'], "$method $uri: ".$r['content']);
            $this->assertProblem(401, ['code' => 'missing_token'], $r);
            $this->assertSame('Bearer', $r['headers']['www-authenticate'][0] ?? null, "$method $uri");
        }

        // Signed in but no member: still 403
        $auth = TestHelper::authHeader($stranger, $this->tokens);
        $this->assertSame(403, $this->req('GET', "/api/clubs/{$club->getId()}", $auth)['status']);
        $this->assertSame(403, $this->req('GET', "/api/calendars/{$cal->getId()}/events", $auth)['status']);
        // The club exists for its member
        $this->assertSame(200, $this->req('GET', "/api/clubs/{$club->getId()}", TestHelper::authHeader($user, $this->tokens))['status']);
    }

    // --- 2. RFC 7807 everywhere ---

    public function testInvalidAndExpiredTokensAreProblems(): void
    {
        $user = TestHelper::createUser($this->em, $this->hasher);

        $r = $this->req('GET', '/api/auth/me', 'Bearer not-a-jwt');
        $this->assertProblem(401, ['code' => 'invalid_token'], $r);
        $this->assertSame('Bearer', $r['headers']['www-authenticate'][0] ?? null);

        $encoder = static::getContainer()->get(JWTEncoderInterface::class);
        $expired = $encoder->encode([
            'email' => $user->getEmail(),
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'iat' => time() - 3600,
            'exp' => time() - 60,
        ]);
        $this->assertProblem(401, ['code' => 'token_expired'], $this->req('GET', '/api/auth/me', 'Bearer '.$expired));

        // Ended session (token version changed): invalid token
        $auth = TestHelper::authHeader($user, $this->tokens);
        $this->em->getConnection()->executeStatement('UPDATE user SET token_version = token_version + 1 WHERE id = ?', [$user->getId()]);
        $this->assertProblem(401, ['code' => 'invalid_token'], $this->req('GET', '/api/auth/me', $auth));
    }

    public function testLoginWithUnconfirmedAddressIsAProblem(): void
    {
        TestHelper::createUser($this->em, $this->hasher, 'new@example.com', 'password123', false);

        $r = $this->req('POST', '/api/auth/login', '', ['email' => 'new@example.com', 'password' => 'password123']);
        $this->assertProblem(403, ['code' => 'email_not_verified'], $r);
        $this->assertArrayNotHasKey('error', $r['body']);
    }

    public function testUnknownOAuthProviderOnTheBrowserRoutesIsA404Problem(): void
    {
        $this->assertProblem(404, ['code' => 'unknown_provider'], $this->req('GET', '/api/auth/oauth/myspace'));
        $this->assertProblem(404, ['code' => 'unknown_provider'], $this->req('GET', '/api/auth/oauth/myspace/link?ticket=x'));
    }

    public function testHolidayCalendarErrorsAreProblems(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";
        $hc = new HolidayCalendar($cal, 'Ferien', 'https://holidays.invalid/y.ics');
        $this->em->persist($hc);
        $this->em->flush();

        $this->assertProblem(404, [], $this->req('PATCH', "$base/".self::UNKNOWN_ID, $auth, ['name' => 'X']));
        $this->assertProblem(404, [], $this->req('DELETE', "$base/".self::UNKNOWN_ID, $auth));
        $this->assertProblem(404, [], $this->req('POST', "$base/".self::UNKNOWN_ID.'/refresh', $auth));

        // The URL cannot be fetched (no server behind .invalid): 422 with its own code
        $this->assertProblem(422, ['code' => 'ics_fetch_failed', 'field' => 'url'], $this->req('POST', "$base/{$hc->getId()}/refresh", $auth));

        $r = $this->req('POST', $base, $auth, ['name' => 'Ferien', 'url' => 'https://holidays.invalid/x.ics']);
        $this->assertProblem(422, ['code' => 'ics_fetch_failed', 'field' => 'url'], $r);
    }

    public function testMapboxProxyErrorsAreProblems(): void
    {
        static::getContainer()->set(MapAvailability::class, new MapAvailability('pk.test'));
        $auth = TestHelper::authHeader(TestHelper::createUser($this->em, $this->hasher), $this->tokens);

        $this->assertProblem(400, ['code' => 'invalid_request'], $this->req('GET', '/api/mapbox/evil.example.com/styles/v1/x', $auth));
        $this->assertProblem(403, [], $this->req('GET', '/api/mapbox/api.mapbox.com/not/allowed/path', $auth));
    }

    // --- 3. every 400 carries a code ---

    public function testFormerlyCodelessBadRequestsCarryCodes(): void
    {
        ['user' => $user, 'calendar' => $cal, 'club' => $club] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $base = "/api/calendars/{$cal->getId()}";
        $template = TestHelper::createTemplate($this->em, $cal);
        $event = TestHelper::createEvent($this->em, $cal);

        // Template times only as half a pair
        $r = $this->req('POST', "$base/templates", $auth, ['name' => 'Halb', 'timeBegin' => '18:00']);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'timeEnd'], $r);
        $r = $this->req('PATCH', "$base/templates/{$template->getId()}", $auth, ['timeBegin' => null]);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'timeBegin'], $r);

        // from-template without templateId / dates
        $r = $this->req('POST', "$base/events/from-template", $auth, ['dates' => ['2026-10-01']]);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'templateId'], $r);
        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $template->getId()]);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'dates'], $r);
        $r = $this->req('POST', "$base/events/from-template", $auth, ['templateId' => $template->getId(), 'dates' => []]);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'dates'], $r);

        // Query parameters sent as arrays
        static::getContainer()->set(MapAvailability::class, new MapAvailability('pk.test'));
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'from'], $this->req('GET', "$base/events?from[]=2026-01-01", $auth));
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'q'], $this->req('GET', '/api/map/geocode/suggest?q[]=x', $auth));
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'scope'], $this->req('DELETE', "$base/events/{$event->getId()}?scope[]=all", $auth));
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'targetGroupIds'], $this->req('GET', "$base/events?targetGroupIds[]=x", $auth));

        // Invalid time zones are input errors like all others (400)
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'timezone'], $this->req('PATCH', "/api/clubs/{$club->getId()}", $auth, ['timezone' => 'Mars/Olympus']));
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'timezone'], $this->req('POST', "$base/events", $auth, [
            'name' => 'T', 'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00', 'timezone' => 'Mars/Olympus',
        ]));
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'timezone'], $this->req('POST', "$base/templates", $auth, ['name' => 'Zone', 'timezone' => 'Mars/Base']));
    }

    // --- 4. holiday calendars: partial PATCH, DELETE like the other deletes ---

    public function testHolidayCalendarPatchIsPartialAndDeleteAnswersOk(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $hc = new HolidayCalendar($cal, 'Ferien', 'https://example.com/ferien.ics');
        $this->em->persist($hc);
        $this->em->flush();
        $url = "/api/calendars/{$cal->getId()}/holiday-calendars/{$hc->getId()}";

        $r = $this->req('PATCH', $url, $auth, ['name' => 'Schulferien']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['Schulferien', 'https://example.com/ferien.ics'], [$r['body']['name'], $r['body']['url']]);

        $r = $this->req('PATCH', $url, $auth, ['url' => 'https://example.com/neu.ics']);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['Schulferien', 'https://example.com/neu.ics'], [$r['body']['name'], $r['body']['url']]);

        $this->assertProblem(422, ['code' => 'validation_failed', 'field' => 'url'], $this->req('PATCH', $url, $auth, ['url' => 'kein-link']));
        $this->assertProblem(422, ['code' => 'validation_failed', 'field' => 'name'], $this->req('PATCH', $url, $auth, ['name' => '']));
        $this->assertProblem(422, ['code' => 'validation_failed', 'field' => 'name'], $this->req('PATCH', $url, $auth, ['name' => 5]));
        $this->assertProblem(422, ['code' => 'validation_failed'], $this->req('PATCH', $url, $auth, ['other' => 'x']));

        $r = $this->req('DELETE', $url, $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['ok' => true], $r['body']);
    }

    public function testHolidayCalendarCreateRejectsNonStringValuesLikePatch(): void
    {
        ['user' => $user, 'calendar' => $cal] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $auth = TestHelper::authHeader($user, $this->tokens);
        $base = "/api/calendars/{$cal->getId()}/holiday-calendars";

        // Checked before anything is fetched: no "Array" / "5" names, no ics_fetch_failed for a wrong type
        foreach ([
            [['name' => ['Ferien'], 'url' => 'https://holidays.invalid/x.ics'], 'name'],
            [['name' => 5, 'url' => 'https://holidays.invalid/x.ics'], 'name'],
            [['name' => 'Ferien', 'url' => ['https://holidays.invalid/x.ics']], 'url'],
            [['name' => 'Ferien', 'url' => true], 'url'],
        ] as [$body, $field]) {
            $this->assertProblem(422, ['code' => 'validation_failed', 'field' => $field], $this->req('POST', $base, $auth, $body));
        }
        $this->assertSame(0, $this->em->getRepository(HolidayCalendar::class)->count([]));
    }

    // --- 5. Mapbox proxy: GET only ---

    public function testMapboxProxyAllowsOnlyGet(): void
    {
        static::getContainer()->set(MapAvailability::class, new MapAvailability('pk.test'));
        $auth = TestHelper::authHeader(TestHelper::createUser($this->em, $this->hasher), $this->tokens);
        foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $method) {
            $r = $this->req($method, '/api/mapbox/api.mapbox.com/styles/v1/mapbox/streets-v12', $auth);
            $this->assertProblem(405, [], $r);
            $this->assertStringContainsString('GET', $r['headers']['allow'][0] ?? '', $method);
        }
    }

    // --- 7. members: unknown ids are 404 ---

    public function testRemovingANonMemberIs404WithTheSameAnswerForUnknownUsers(): void
    {
        ['user' => $user, 'club' => $club] = TestHelper::createCalendarWithClub($this->em, $this->hasher);
        $outsider = TestHelper::createUser($this->em, $this->hasher);
        $member = TestHelper::createUser($this->em, $this->hasher);
        $this->em->persist((new ClubUser())->setClub($club)->setUser($member));
        $this->em->flush();
        $auth = TestHelper::authHeader($user, $this->tokens);
        $url = "/api/clubs/{$club->getId()}/members";

        $outsiderAnswer = $this->req('DELETE', "$url/{$outsider->getId()}", $auth);
        $this->assertProblem(404, ['code' => 'member_not_found'], $outsiderAnswer);
        $unknownAnswer = $this->req('DELETE', "$url/".self::UNKNOWN_ID, $auth);
        $this->assertProblem(404, ['code' => 'member_not_found'], $unknownAnswer);
        // No account oracle: an existing user outside the club and an unknown id look the same
        $this->assertSame($outsiderAnswer['body'], $unknownAnswer['body']);

        $r = $this->req('DELETE', "$url/{$member->getId()}", $auth);
        $this->assertSame(200, $r['status'], $r['content']);
        $this->assertSame(['ok' => true], $r['body']);
        $this->assertProblem(404, ['code' => 'member_not_found'], $this->req('DELETE', "$url/{$member->getId()}", $auth));
    }
}
