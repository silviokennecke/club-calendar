<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Entity\UserConsent;
use App\Enum\LegalDocumentType;
use App\Security\OneTimeTokenService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ConsentTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        $c = static::getContainer();
        self::$em = $c->get(EntityManagerInterface::class);
        self::$hasher = $c->get(UserPasswordHasherInterface::class);
        self::$tokens = $c->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
    }

    private function register(array $extra = [], string $email = 'new@example.com'): array
    {
        self::$client->setServerParameter('HTTP_USER_AGENT', 'TestAgent/1.0');

        return TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/register', [
            'name' => 'New', 'email' => $email, 'password' => 'password123',
        ] + $extra);
    }

    private function auth(User $user): string
    {
        return TestHelper::authHeader($user, self::$tokens);
    }

    private function user(): User
    {
        return TestHelper::createUser(self::$em, self::$hasher);
    }

    // --- Registration ---

    public function testRegisterWithoutDocumentsNeedsNoAcceptance(): void
    {
        $this->assertSame(201, $this->register()['status']);
    }

    public function testRegisterRequiresAllCurrentDocuments(): void
    {
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $terms = LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        LegalTestHelper::publish(self::$em, LegalDocumentType::IMPRINT);

        $r = $this->register();
        $this->assertSame(422, $r['status']);
        $this->assertSame('consent_required', $r['body']['code']);
        $this->assertSame('acceptedDocuments', $r['body']['field']);
        $this->assertEqualsCanonicalizing(
            [['type' => 'privacy', 'id' => $privacy->getId()], ['type' => 'terms', 'id' => $terms->getId()]],
            $r['body']['documents'],
        );

        $r = $this->register(['acceptedDocuments' => [$privacy->getId()]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('consent_required', $r['body']['code']);
        $this->assertSame([['type' => 'terms', 'id' => $terms->getId()]], $r['body']['documents']);
        $this->assertSame(0, self::$em->getRepository(User::class)->count([]));
    }

    public function testRegisterStoresConsentsWithIpAndUserAgent(): void
    {
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $terms = LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);

        $r = $this->register(['acceptedDocuments' => [$privacy->getId(), $terms->getId()]]);
        $this->assertSame(201, $r['status']);
        $user = self::$em->getRepository(User::class)->findOneBy(['email' => 'new@example.com']);
        $consents = self::$em->getRepository(UserConsent::class)->findBy(['user' => $user->getId()]);
        $this->assertCount(2, $consents);
        $this->assertSame('TestAgent/1.0', $consents[0]->getUserAgent());
        $this->assertNotEmpty($consents[0]->getIpAddress());
    }

    public function testRegisterWithOutdatedDocument(): void
    {
        $old = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v1', new \DateTimeImmutable('-2 days'));
        $new = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v2');

        $r = $this->register(['acceptedDocuments' => [$old->getId()]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('consent_outdated', $r['body']['code']);
        $this->assertSame('acceptedDocuments', $r['body']['field']);
        $this->assertSame([['type' => 'privacy', 'id' => $new->getId()]], $r['body']['documents']);
    }

    public function testRegisterWithUnknownIdOrWrongTypeIs400(): void
    {
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        foreach ([['nope'], [$privacy->getId(), 'nope'], [123]] as $ids) {
            $r = $this->register(['acceptedDocuments' => $ids]);
            $this->assertSame(400, $r['status'], json_encode($ids));
            $this->assertSame('validation_failed', $r['body']['code']);
            $this->assertSame('acceptedDocuments', $r['body']['field']);
        }
        $this->assertSame(400, $this->register(['acceptedDocuments' => 'x'])['status']);
    }

    public function testConsentIsCheckedBeforeEmailTaken(): void
    {
        $this->register();
        LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $r = $this->register();
        $this->assertSame('consent_required', $r['body']['code']);
    }

    // --- /me ---

    public function testMeShowsPendingConsents(): void
    {
        $user = $this->user();
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $this->auth($user));
        $this->assertSame([], $r['body']['pendingConsents']);
        $this->assertFalse($r['body']['consentRequired']);

        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'Datenschutz');
        LegalTestHelper::publish(self::$em, LegalDocumentType::IMPRINT);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $this->auth($user));
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['consentRequired']);
        $this->assertCount(1, $r['body']['pendingConsents']);
        $this->assertSame(['type', 'id', 'title', 'publishedAt'], array_keys($r['body']['pendingConsents'][0]));
        $this->assertSame($privacy->getId(), $r['body']['pendingConsents'][0]['id']);
    }

    // --- POST/GET /consents ---

    public function testGiveConsentsReturnsMeAndIsIdempotent(): void
    {
        $user = $this->user();
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $terms = LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        $h = $this->auth($user);

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$privacy->getId()]], $h);
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['consentRequired']);
        $this->assertSame([$terms->getId()], array_column($r['body']['pendingConsents'], 'id'));

        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$privacy->getId(), $terms->getId()]], $h);
        $this->assertSame(200, $r['status']);
        $this->assertFalse($r['body']['consentRequired']);
        $this->assertSame(2, self::$em->getRepository(UserConsent::class)->count(['user' => $user->getId()]));
    }

    public function testGiveConsentsRejectsOutdatedAndInvalidInput(): void
    {
        $user = $this->user();
        $old = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v1', new \DateTimeImmutable('-2 days'));
        $new = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v2');
        $imprint = LegalTestHelper::publish(self::$em, LegalDocumentType::IMPRINT);
        $h = $this->auth($user);

        foreach ([$old->getId(), $imprint->getId()] as $id) {
            $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$id]], $h);
            $this->assertSame(422, $r['status']);
            $this->assertSame('consent_outdated', $r['body']['code']);
            $this->assertSame([['type' => 'privacy', 'id' => $new->getId()]], $r['body']['documents']);
        }
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => ['nope']], $h);
        $this->assertSame(400, $r['status']);
        $r = TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => []], $h);
        $this->assertSame(400, $r['status']);
        $this->assertSame(0, self::$em->getRepository(UserConsent::class)->count([]));
    }

    public function testConsentsRequireAuthentication(): void
    {
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/consents')['status']);
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => ['x']])['status']);
    }

    public function testConsentHistoryNewestFirstWithCurrentFlag(): void
    {
        $user = $this->user();
        $v1 = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v1', new \DateTimeImmutable('-2 days'));
        $h = $this->auth($user);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$v1->getId()]], $h);
        $v2 = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v2');
        $terms = LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        // consent to v2 and terms after the first one
        sleep(1);
        $this->assertSame(403, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h)['status']);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$v2->getId(), $terms->getId()]], $h);

        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/consents', [], $h);
        $this->assertSame(200, $r['status']);
        $this->assertCount(3, $r['body']);
        $this->assertSame($v1->getId(), $r['body'][2]['documentId']);
        $this->assertFalse($r['body'][2]['current']);
        $this->assertSame('v1', $r['body'][2]['documentTitle']);
        $this->assertTrue($r['body'][0]['current']);
        $this->assertContains('consentedAt', array_keys($r['body'][0]));
        $this->assertArrayHasKey('ipAddress', $r['body'][0]);
        $this->assertArrayHasKey('userAgent', $r['body'][0]);
        $this->assertArrayHasKey('documentPublishedAt', $r['body'][0]);

        // another user sees none of it
        $other = $this->user();
        $this->assertSame([], TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/consents', [], $this->auth($other))['body']);
    }

    // --- Gate ---

    public function testGateBlocksApiRoutesUntilConsent(): void
    {
        $user = $this->user();
        $club = TestHelper::createClub(self::$em, $user);
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $h = $this->auth($user);

        foreach ([['GET', '/api/clubs'], ['GET', '/api/clubs/'.$club->getId()], ['PATCH', '/api/auth/me'], ['GET', '/api/invitations'], ['POST', '/api/auth/change-password']] as [$method, $uri]) {
            $r = TestHelper::jsonRequest(self::$client, $method, $uri, [], $h);
            $this->assertSame(403, $r['status'], "$method $uri");
            $this->assertSame('consent_required', $r['body']['code'], "$method $uri");
            $this->assertSame([['type' => 'privacy', 'id' => $privacy->getId()]], $r['body']['documents']);
        }

        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$privacy->getId()]], $h);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h)['status']);
    }

    public function testGateAllowList(): void
    {
        $user = $this->user();
        LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        $h = $this->auth($user);

        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], $h)['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/consents', [], $h)['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/legal', [], $h)['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/terms', [], $h)['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/providers', [], $h)['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/health', [], $h)['status']);
        $this->assertSame(409, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/delete-account/code', [], $h)['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout', ['refresh_token' => 'x'], $h)['status']);
        $this->assertSame(204, TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/logout-all', [], $h)['status']);
    }

    public function testAccountDeletionStaysPossibleWithoutConsent(): void
    {
        $user = $this->user();
        LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        $r = TestHelper::jsonRequest(self::$client, 'DELETE', '/api/auth/me', ['password' => 'password123'], $this->auth($user));
        $this->assertSame(200, $r['status']);
    }

    public function testNoGateForUnauthenticatedAndPublicRoutes(): void
    {
        LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $this->assertSame(401, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs')['status']);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/health')['status']);
    }

    public function testImprintNeverNeedsConsent(): void
    {
        $user = $this->user();
        LegalTestHelper::publish(self::$em, LegalDocumentType::IMPRINT);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $this->auth($user))['status']);
    }

    public function testReconsentAfterNewDocumentVersion(): void
    {
        $user = $this->user();
        $v1 = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v1', new \DateTimeImmutable('-2 days'));
        $h = $this->auth($user);
        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$v1->getId()]], $h);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h)['status']);

        $v2 = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v2');
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h);
        $this->assertSame(403, $r['status']);
        $this->assertSame([['type' => 'privacy', 'id' => $v2->getId()]], $r['body']['documents']);

        TestHelper::jsonRequest(self::$client, 'POST', '/api/auth/consents', ['documentIds' => [$v2->getId()]], $h);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h)['status']);
    }

    public function testRetiredDocumentNoLongerGates(): void
    {
        $user = $this->user();
        $doc = LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        $h = $this->auth($user);
        $this->assertSame(403, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h)['status']);
        // plain SQL: the kernel was rebooted by the request, the test's entity manager is stale
        static::getContainer()->get(EntityManagerInterface::class)->getConnection()
            ->executeStatement('UPDATE legal_document SET retired_at = :t WHERE id = :id', ['t' => date('Y-m-d H:i:s'), 'id' => $doc->getId()]);
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $h)['status']);
    }

    public function testRegisteredUserWithConsentIsNotGatedButSsoUserIs(): void
    {
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY);
        $this->register(['acceptedDocuments' => [$privacy->getId()]], 'reg@example.com');
        $reg = self::$em->getRepository(User::class)->findOneBy(['email' => 'reg@example.com']);
        $reg->setIsEmailVerified(true);
        self::$em->flush();
        $this->assertSame(200, TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], $this->auth($reg))['status']);

        // SSO-created user: no consent was given at creation
        $sso = new User();
        $sso->setName('Sso');
        $sso->setEmail('sso@example.com');
        $sso->setIsEmailVerified(true);
        self::$em->persist($sso);
        self::$em->flush();
        $token = static::getContainer()->get(OneTimeTokenService::class)->issue($sso, OneTimeTokenService::PURPOSE_EMAIL_VERIFIED, 30);
        self::$client->request('POST', '/api/auth/token', ['grant_type' => 'one_time_token', 'token' => $token]);
        $this->assertSame(200, self::$client->getResponse()->getStatusCode(), 'login itself still returns tokens');
        $access = json_decode(self::$client->getResponse()->getContent(), true)['access_token'];
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/clubs', [], 'Bearer '.$access);
        $this->assertSame(403, $r['status']);
        $this->assertSame('consent_required', $r['body']['code']);
        $me = TestHelper::jsonRequest(self::$client, 'GET', '/api/auth/me', [], 'Bearer '.$access);
        $this->assertTrue($me['body']['consentRequired']);
    }
}
