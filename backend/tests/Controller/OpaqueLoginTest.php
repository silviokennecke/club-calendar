<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Entity\UserConsent;
use App\Enum\LegalDocumentType;
use App\Opaque\Base64Url;
use App\Opaque\OpaqueService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use App\Tests\Opaque\OpaqueTestClient;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Clock\Test\ClockSensitiveTrait;

class OpaqueLoginTest extends WebTestCase
{
    use ClockSensitiveTrait;

    private const string PASSWORD = 'correct horse battery';

    private KernelBrowser $client;
    private OpaqueTestClient $opaque;

    protected function setUp(): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->opaque = new OpaqueTestClient();
        DatabaseResetter::reset($this->em());
    }

    protected function tearDown(): void
    {
        static::mockTime(false);
        // Kernel stays up so mailer assertions see the mails of the requests (same pattern as AuthTest).
    }

    private function em(): EntityManagerInterface
    {
        return static::getContainer()->get(EntityManagerInterface::class);
    }

    private function user(string $email = 'ada@example.com', bool $verified = true, bool $record = true): User
    {
        $user = (new User())->setName('Ada')->setEmail($email)->setIsEmailVerified($verified);
        if ($record) {
            $service = static::getContainer()->get(OpaqueService::class);
            $reg = $this->opaque->startRegistration(self::PASSWORD);
            $response = $service->registrationResponse($user, $reg['request']);
            $service->storeRecord($user, $this->opaque->finishRegistration(self::PASSWORD, $reg['blind'], $response)['record'], $service->activeKeyId());
        } else {
            $user->setPassword('$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
        }
        $this->em()->persist($user);
        $this->em()->flush();

        return $user;
    }

    /** @return array{status: int, body: array, headers: array} */
    private function post(string $path, array $body): array
    {
        return TestHelper::jsonRequest($this->client, 'POST', '/api/auth/opaque/login/'.$path, $body);
    }

    /** @return array{start: array, ke1: array, ke3: ?string} */
    private function start(string $email, string $password = self::PASSWORD): array
    {
        $ke1 = $this->opaque->startLogin($password);
        $start = $this->post('start', ['email' => $email, 'startLoginRequest' => Base64Url::encode($ke1['ke1'])]);
        $ke3 = null;
        if (200 === $start['status']) {
            $result = $this->opaque->finishLogin($password, $ke1, Base64Url::decode($start['body']['loginResponse']) ?? '');
            $ke3 = $result['ke3'] ?? null;
        }

        return ['start' => $start, 'ke1' => $ke1, 'ke3' => $ke3];
    }

    private function finish(array $flow, ?string $ke3 = null): array
    {
        return $this->post('finish', [
            'loginState' => $flow['start']['body']['loginState'],
            'finishLoginRequest' => Base64Url::encode($ke3 ?? $flow['ke3']),
        ]);
    }

    private static function claims(string $jwt): array
    {
        return json_decode((string) base64_decode(explode('.', $jwt)[1]), true);
    }

    public function testLoginIssuesTokensThatWorkOnMe(): void
    {
        $this->user();
        $flow = $this->start('Ada@Example.com');
        $this->assertSame(200, $flow['start']['status']);
        $this->assertSame('memory-constrained', $flow['start']['body']['ksfProfile']);
        $this->assertSame(320, strlen(Base64Url::decode($flow['start']['body']['loginResponse'])));

        $r = $this->finish($flow);
        $this->assertSame(200, $r['status']);
        $this->assertNotEmpty($r['body']['access_token']);
        $this->assertNotEmpty($r['body']['refresh_token']);
        $this->assertFalse($r['body']['emailVerificationRequired']);

        $me = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$r['body']['access_token']);
        $this->assertSame(200, $me['status']);
        $this->assertSame('ada@example.com', $me['body']['email']);

        $this->client->request('POST', '/api/auth/token', ['grant_type' => 'refresh_token', 'refresh_token' => $r['body']['refresh_token']]);
        $this->assertSame(200, $this->client->getResponse()->getStatusCode());
    }

    public function testUnverifiedUserGetsRestrictedSessionAndCodeMail(): void
    {
        $this->user('new@example.com', false);
        $r = $this->finish($this->start('new@example.com'));
        $this->assertSame(200, $r['status']);
        $this->assertTrue($r['body']['emailVerificationRequired']);
        $this->assertEmailCount(1);
        $this->assertEmailAddressContains($this->getMailerMessage(), 'to', 'new@example.com');

        $clubs = TestHelper::jsonRequest($this->client, 'GET', '/api/clubs', [], 'Bearer '.$r['body']['access_token']);
        $this->assertSame(403, $clubs['status']);
        $this->assertSame('email_verification_required', $clubs['body']['code']);
    }

    public function testPendingConsentGatesTheNewSession(): void
    {
        $user = $this->user();
        $em = $this->em();
        $privacy = LegalTestHelper::publish($em, LegalDocumentType::PRIVACY);

        $gated = $this->finish($this->start('ada@example.com'))['body'];
        $this->assertFalse(self::claims($gated['access_token'])['lc']);
        $this->assertSame(403, TestHelper::jsonRequest($this->client, 'GET', '/api/clubs', [], 'Bearer '.$gated['access_token'])['status']);

        $em = $this->em();
        $em->persist(new UserConsent($em->find(User::class, $user->getId()), $em->find($privacy::class, $privacy->getId()), new \DateTimeImmutable(), null, null));
        $em->flush();
        $ok = $this->finish($this->start('ada@example.com'))['body'];
        $this->assertTrue(self::claims($ok['access_token'])['lc']);
        $this->assertSame(200, TestHelper::jsonRequest($this->client, 'GET', '/api/clubs', [], 'Bearer '.$ok['access_token'])['status']);
    }

    public function testUnknownAddressLegacyUserAndRealUserLookAlike(): void
    {
        $this->user('real@example.com');
        $this->user('legacy@example.com', true, false);

        $shapes = [];
        foreach (['real@example.com', 'legacy@example.com', 'nobody@example.com'] as $email) {
            $flow = $this->start($email);
            $r = $flow['start'];
            $this->assertSame(200, $r['status']);
            $shapes[] = [
                'keys' => array_keys($r['body']),
                'ke2' => strlen(Base64Url::decode($r['body']['loginResponse'])),
                'state' => strlen($r['body']['loginState']),
                'ksf' => $r['body']['ksfProfile'],
            ];
        }
        $this->assertSame($shapes[0], $shapes[1]);
        $this->assertSame($shapes[0], $shapes[2]);
    }

    public function testFailuresAreAllTheSame401(): void
    {
        $this->user();
        $good = $this->start('ada@example.com');
        $forged = $ke3 = $good['ke3'];
        $forged[0] = chr(ord($forged[0]) ^ 1);
        $badMac = $this->finish($good, $forged);

        $tampered = $this->start('ada@example.com');
        $blob = $tampered['start']['body']['loginState'];
        $blob[20] = 'A' === $blob[20] ? 'B' : 'A';
        $tamperedR = $this->post('finish', ['loginState' => $blob, 'finishLoginRequest' => Base64Url::encode($tampered['ke3'])]);

        $unknown = $this->start('nobody@example.com');
        $fake = $this->finish($unknown, random_bytes(64));

        $replayFlow = $this->start('ada@example.com');
        $this->assertSame(200, $this->finish($replayFlow)['status']);
        $replay = $this->finish($replayFlow);

        $garbage = $this->post('finish', ['loginState' => 'AAAA', 'finishLoginRequest' => Base64Url::encode(random_bytes(64))]);

        $results = [$badMac, $tamperedR, $fake, $replay, $garbage];
        foreach ($results as $r) {
            $this->assertSame(401, $r['status']);
            $this->assertSame('invalid_credentials', $r['body']['code']);
            $this->assertSame($badMac['body'], $r['body']);
        }
    }

    public function testExpiredStateIsRejected(): void
    {
        $this->user();
        $flow = $this->start('ada@example.com');
        static::mockTime('+5 minutes');
        $r = $this->finish($flow);
        $this->assertSame(401, $r['status']);
        $this->assertSame('invalid_credentials', $r['body']['code']);
    }

    public function testAccountDeletedOrChangedBetweenStepsIs401(): void
    {
        $user = $this->user();
        $flow = $this->start('ada@example.com');
        $em = $this->em();
        $em->remove($em->find(User::class, $user->getId()));
        $em->flush();
        $this->assertSame(401, $this->finish($flow)['status']);

        $user = $this->user('bob@example.com');
        $flow = $this->start('bob@example.com');
        $em = $this->em();
        $em->find(User::class, $user->getId())->invalidateTokens();
        $em->flush();
        $this->assertSame(401, $this->finish($flow)['status']);
    }

    public function testStartConsumesTheLoginLimitsAndFinishDoesNot(): void
    {
        $this->user();
        for ($i = 0; $i < 4; ++$i) {
            $flow = $this->start('ada@example.com');
            $forged = (string) $flow['ke3'] ^ str_repeat("\1", 64);
            $this->assertSame(401, $this->finish($flow, $forged)['status']);
        }
        $this->assertSame(200, $this->start('ada@example.com')['start']['status']);

        $limited = $this->start('ada@example.com')['start'];
        $this->assertSame(429, $limited['status']);
        $this->assertSame('rate_limited', $limited['body']['code']);
        $this->assertGreaterThanOrEqual(1, (int) ($limited['headers']['retry-after'][0] ?? 0));
    }

    public function testSuccessClearsTheAddressBucket(): void
    {
        $this->user();
        for ($i = 0; $i < 3; ++$i) {
            $this->start('ada@example.com');
        }
        $this->assertSame(200, $this->finish($this->start('ada@example.com'))['status']);
        for ($i = 0; $i < 5; ++$i) {
            $this->assertSame(200, $this->start('ada@example.com')['start']['status']);
        }
    }

    public function testMalformedInputIs400Or422(): void
    {
        $ke1 = Base64Url::encode($this->opaque->startLogin(self::PASSWORD)['ke1']);
        $cases = [
            ['start', ['email' => 'a@example.com', 'startLoginRequest' => '!!!'], 400, 'invalid_opaque_message'],
            ['start', ['email' => 'a@example.com', 'startLoginRequest' => $ke1.'='], 400, 'invalid_opaque_message'],
            ['start', ['email' => 'a@example.com', 'startLoginRequest' => Base64Url::encode(random_bytes(95))], 400, 'invalid_opaque_message'],
            ['start', ['email' => 'a@example.com', 'startLoginRequest' => Base64Url::encode(str_repeat("\xff", 96))], 400, 'invalid_opaque_message'],
            ['start', ['email' => 'a@example.com', 'startLoginRequest' => 5], 400, 'invalid_request'],
            ['start', ['email' => 'not-an-email', 'startLoginRequest' => $ke1], 422, 'validation_failed'],
            ['start', ['email' => 'a@example.com'], 422, 'validation_failed'],
            ['finish', ['loginState' => 'abc', 'finishLoginRequest' => Base64Url::encode(random_bytes(63))], 400, 'invalid_opaque_message'],
            ['finish', ['loginState' => 'abc', 'finishLoginRequest' => '***'], 400, 'invalid_opaque_message'],
            ['finish', ['loginState' => '', 'finishLoginRequest' => Base64Url::encode(random_bytes(64))], 422, 'validation_failed'],
        ];
        foreach ($cases as [$path, $body, $status, $code]) {
            $r = $this->post($path, $body);
            $this->assertSame($status, $r['status'], json_encode($body));
            $this->assertSame($code, $r['body']['code'], json_encode($body));
        }
    }
}
