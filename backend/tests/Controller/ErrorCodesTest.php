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
 * Stable `code` (and `field`) in the RFC 7807 body of the 4xx errors the frontend reacts to, so that it
 * never compares `detail` texts (docs/api/openapi.yaml, schema ErrorCode).
 */
class ErrorCodesTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $container = static::getContainer();
        self::$em = $container->get(EntityManagerInterface::class);
        self::$hasher = $container->get(UserPasswordHasherInterface::class);
        self::$tokens = $container->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    /** @param array<string, mixed> $expected subset of the body */
    private function assertProblem(int $status, array $expected, array $r): void
    {
        $this->assertSame($status, $r['status'], $r['content']);
        $this->assertStringStartsWith('application/problem+json', $r['headers']['content-type'][0] ?? '');
        foreach ($expected as $key => $value) {
            $this->assertSame($value, $r['body'][$key] ?? null, "$key in ".$r['content']);
        }
    }

    public function testRegistrationAndLogin(): void
    {
        TestHelper::createUser(self::$em, self::$hasher, 'taken@example.com', 'password123');
        TestHelper::createUser(self::$em, self::$hasher, 'new@example.com', 'password123', false);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', ['name' => 'X', 'email' => 'taken@example.com', 'password' => 'password123']);
        $this->assertProblem(400, ['code' => 'email_taken', 'field' => 'email', 'detail' => 'Email already in use'], $r);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', ['name' => 'X', 'email' => 'kein-email', 'password' => 'password123']);
        $this->assertProblem(422, ['code' => 'validation_failed', 'field' => 'email'], $r);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => 'taken@example.com', 'password' => 'falsch-falsch']);
        $this->assertProblem(401, ['code' => 'invalid_credentials'], $r);
        $this->assertSame('Bearer', $r['headers']['www-authenticate'][0] ?? null);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => 'nobody@example.com', 'password' => 'password123']);
        $this->assertProblem(401, ['code' => 'invalid_credentials'], $r);

        // Unconfirmed address: the original body stays, `code` is added
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/login', ['email' => 'new@example.com', 'password' => 'password123']);
        $this->assertSame(403, $r['status']);
        $this->assertSame(['error' => 'email_not_verified', 'code' => 'email_not_verified'], $r['body']);
    }

    public function testRefreshTokens(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => 'kaputt']);
        $r = ['status' => self::$client->getResponse()->getStatusCode(), 'content' => (string) self::$client->getResponse()->getContent(), 'headers' => self::$client->getResponse()->headers->all()];
        $r['body'] = json_decode($r['content'], true);
        $this->assertProblem(401, ['code' => 'invalid_refresh_token'], $r);

        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'password']);
        $body = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertSame(400, self::$client->getResponse()->getStatusCode());
        $this->assertSame('invalid_grant', $body['code']);

        // A valid token of a user whose sessions were ended
        $refresh = self::$tokens->tokenResponse($user)['refresh_token'];
        self::$em->find($user::class, $user->getId())?->invalidateTokens();
        self::$em->flush();
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $refresh]);
        $body = json_decode((string) self::$client->getResponse()->getContent(), true);
        $this->assertSame(401, self::$client->getResponse()->getStatusCode());
        $this->assertSame('invalid_refresh_token', $body['code']);
    }

    public function testPasskeys(): void
    {
        $user = TestHelper::createUser(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/authenticate/verify', ['challengeToken' => 'forged', 'response' => ['id' => 'x']]);
        $this->assertProblem(401, ['code' => 'invalid_passkey', 'detail' => 'Invalid passkey'], $r);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/authenticate/verify', ['challengeToken' => 'forged']);
        $this->assertProblem(400, ['code' => 'invalid_request'], $r);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/webauthn/register/verify', ['challengeToken' => 'forged', 'response' => ['id' => 'x']], $auth);
        $this->assertProblem(400, ['code' => 'invalid_passkey_registration'], $r);
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/webauthn/gibt-es-nicht', [], $auth);
        $this->assertProblem(404, ['code' => 'passkey_not_found'], $r);
    }

    public function testEventInputErrorsNameTheField(): void
    {
        ['user' => $user, 'calendar' => $cal, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/events";
        $clubs = "/api/clubs/{$club->getId()}";
        $valid = ['name' => 'T', 'date' => '2026-10-01', 'timeBegin' => '19:00', 'timeEnd' => '21:00'];

        $r = TestHelper::jsonRequest(self::$client, 'POST', $base, ['name' => ''] + $valid, $auth);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'name', 'detail' => 'name is required'], $r);
        $r = TestHelper::jsonRequest(self::$client, 'POST', $base, ['dateEnd' => '2026-09-01'] + $valid, $auth);
        $this->assertProblem(400, ['code' => 'validation_failed', 'field' => 'dateEnd'], $r);
        $r = TestHelper::jsonRequest(self::$client, 'POST', $base, ['locationId' => '00000000-0000-0000-0000-000000000000'] + $valid, $auth);
        $this->assertProblem(422, ['code' => 'unknown_reference', 'field' => 'locationId'], $r);
        $r = TestHelper::jsonRequest(self::$client, 'POST', $base, ['timezone' => 'Mars/Olympus'] + $valid, $auth);
        $this->assertProblem(422, ['code' => 'validation_failed', 'field' => 'timezone'], $r);
    }

    public function testBodiesThatAreNoJsonObjectAreInvalidRequests(): void
    {
        ['user' => $user, 'calendar' => $cal, 'club' => $club] = TestHelper::createCalendarWithClub(self::$em, self::$hasher);
        $auth = TestHelper::authHeader($user, self::$tokens);
        $base = "/api/calendars/{$cal->getId()}/events";
        $clubs = "/api/clubs/{$club->getId()}";

        foreach (['/api/auth/register', '/api/auth/login', '/api/auth/resend-verification'] as $path) {
            self::$client->request('POST', $path, [], [], ['CONTENT_TYPE' => 'application/json'], '{kaputt');
            $body = json_decode((string) self::$client->getResponse()->getContent(), true);
            $this->assertSame(400, self::$client->getResponse()->getStatusCode(), $path);
            $this->assertSame('invalid_request', $body['code'] ?? null, $path);
        }
        foreach (['/api/clubs', "$clubs/members", "$clubs/calendars"] as $path) {
            self::$client->request('POST', $path, [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $auth], '{kaputt');
            $body = json_decode((string) self::$client->getResponse()->getContent(), true);
            $this->assertSame(400, self::$client->getResponse()->getStatusCode(), $path);
            $this->assertSame('invalid_request', $body['code'] ?? null, $path);
        }
        foreach (["$base/import", "$base/import/preview", "$base/bulk"] as $path) {
            self::$client->request('POST', $path, [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => $auth], '"kein Objekt"');
            $body = json_decode((string) self::$client->getResponse()->getContent(), true);
            $this->assertSame(400, self::$client->getResponse()->getStatusCode(), $path);
            $this->assertSame('invalid_request', $body['code'] ?? null, $path);
        }
    }
}
