<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\User;
use App\Enum\FeedSignup;
use App\Enum\FeedVisibility;
use App\Security\OneTimeTokenService;
use App\Service\ClubInvitationService;
use App\Service\PublicFeedService;
use App\Service\RegistrationPolicy;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\FakeOAuth2Client;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * RESTRICT_REGISTRATION with a feed proof: password registration, identify and SSO accept the address of a feed
 * (and the secret of a PRIVATE one) when the club lets new members in through that feed. Invalid proofs behave
 * exactly like none.
 */
class FeedProofRegistrationTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;
    private FakeOAuth2Client $google;
    private Club $club;
    private $calendar;

    protected function boot(bool $restricted = true): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $c = static::getContainer();
        $c->set(RegistrationPolicy::class, new RegistrationPolicy($c->get(ClubInvitationService::class), $c->get(PublicFeedService::class), $restricted));
        $this->google = new FakeOAuth2Client();
        $c->set('knpu.oauth2.client.google', $this->google);
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $owner = TestHelper::createUser($this->em, $c->get(UserPasswordHasherInterface::class), 'owner@example.com');
        $this->club = TestHelper::createClub($this->em, $owner);
        $this->calendar = TestHelper::createCalendar($this->em, $this->club);
    }

    private function feed(FeedVisibility $v, string $secret = 'secret-abc'): CalendarFeed
    {
        $club = $this->em->find(Club::class, $this->club->getId());
        $calendar = $this->em->find(\App\Entity\Calendar::class, $this->calendar->getId());

        return TestHelper::createFeed($this->em, $club, [$calendar], $v, 'Feed', $secret);
    }

    private function setSignup(FeedSignup $s): void
    {
        $this->em->find(Club::class, $this->club->getId())->setFeedSignup($s);
        $this->em->flush();
    }

    private function register(?array $proof, string $email = 'new@example.com'): array
    {
        $body = ['name' => 'New', 'email' => $email, 'password' => 'password123'];
        if (null !== $proof) {
            $body['feedProof'] = $proof;
        }

        return TestHelper::jsonRequest($this->client, 'POST', '/api/auth/register', $body);
    }

    private function identify(?array $proof, string $email = 'new@example.com'): array
    {
        $body = ['email' => $email] + (null === $proof ? [] : ['feedProof' => $proof]);

        return TestHelper::jsonRequest($this->client, 'POST', '/api/auth/identify', $body);
    }

    private function users(string $email): int
    {
        $this->em->clear();

        return $this->em->getRepository(User::class)->count(['email' => $email]);
    }

    public static function validProofs(): iterable
    {
        yield 'internal club feed' => ['internal', FeedVisibility::CLUB, false];
        yield 'internal private feed' => ['internal', FeedVisibility::PRIVATE, true];
        yield 'public public feed' => ['public', FeedVisibility::PUBLIC, false];
        yield 'public club feed' => ['public', FeedVisibility::CLUB, false];
    }

    #[DataProvider('validProofs')]
    public function testValidProofLiftsTheRestrictionButDoesNotJoin(string $setting, FeedVisibility $v, bool $secret): void
    {
        $this->boot();
        $feed = $this->feed($v);
        $this->setSignup(FeedSignup::from($setting));
        $proof = ['feedId' => $feed->getId()] + ($secret ? ['secret' => 'secret-abc'] : []);

        $this->assertSame('register', $this->identify($proof)['body']['status']);
        $r = $this->register($proof);
        $this->assertSame(201, $r['status'], $r['content']);
        $this->assertSame(1, $this->users('new@example.com'));
        $this->assertSame('0', (string) $this->em->getConnection()->fetchOne(
            'SELECT COUNT(*) FROM club_user cu JOIN user u ON u.id = cu.user_id WHERE u.email = ?', ['new@example.com']));
    }

    public static function invalidProofs(): iterable
    {
        yield 'setting off' => ['off', FeedVisibility::CLUB, null];
        yield 'internal does not cover public feeds' => ['internal', FeedVisibility::PUBLIC, null];
        yield 'private without secret' => ['internal', FeedVisibility::PRIVATE, null];
        yield 'private wrong secret' => ['internal', FeedVisibility::PRIVATE, 'wrong'];
    }

    #[DataProvider('invalidProofs')]
    public function testInvalidProofBehavesExactlyLikeNoProof(string $setting, FeedVisibility $v, ?string $secret): void
    {
        $this->boot();
        $feed = $this->feed($v);
        $this->setSignup(FeedSignup::from($setting));
        $proof = ['feedId' => $feed->getId()] + (null === $secret ? [] : ['secret' => $secret]);

        $this->assertSame($this->identify(null)['body'], $this->identify($proof)['body']);
        $this->assertSame('registration_restricted', $this->identify($proof)['body']['status']);
        $none = $this->register(null);
        $bad = $this->register($proof);
        $this->assertSame(403, $bad['status']);
        $this->assertSame($none['body'], $bad['body']);
        $this->assertSame(0, $this->users('new@example.com'));
    }

    public function testUnknownMalformedAndOddProofsEqualNoProof(): void
    {
        $this->boot();
        $this->setSignup(FeedSignup::PUBLIC);
        $none = $this->register(null, 'odd@example.com');
        foreach ([['feedId' => 'does-not-exist'], ['feedId' => 5], ['feedId' => ['x']], ['secret' => 'x'], []] as $i => $proof) {
            $r = $this->register($proof, "odd$i@example.com");
            $this->assertSame($none['status'], $r['status']);
            $this->assertSame($none['body'], $r['body']);
        }
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/register', ['name' => 'N', 'email' => 'odd9@example.com', 'password' => 'password123', 'feedProof' => 'junk']);
        $this->assertSame($none['body'], $r['body']);
    }

    public function testUnrestrictedModeIgnoresProofs(): void
    {
        $this->boot(false);
        $this->setSignup(FeedSignup::OFF);
        $this->assertSame('register', $this->identify(['feedId' => 'nope'])['body']['status']);
        $this->assertSame(201, $this->register(['feedId' => 'nope'])['status']);
    }

    public function testExistingAccountsStayLogin(): void
    {
        $this->boot();
        $this->assertSame('login', $this->identify(null, 'owner@example.com')['body']['status']);
    }

    private function ssoStart(array $params): array
    {
        $this->client->getCookieJar()->clear();
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google?'.http_build_query(['code_challenge' => OneTimeTokenService::challengeFor(str_repeat('v', 43))] + $params));
        $location = (string) $this->client->getResponse()->headers->get('Location');
        parse_str((string) parse_url($location, \PHP_URL_QUERY), $q);

        return $q;
    }

    private function ssoCallback(array $q, string $email = 'sso@example.com'): array
    {
        $this->google->claims = ['sub' => 'g-1', 'email' => $email, 'email_verified' => true, 'name' => 'G'];
        $this->client->request('GET', 'https://localhost/api/auth/oauth/google/callback?'.http_build_query(['code' => 'c', 'state' => $q['state'] ?? '']));
        parse_str((string) parse_url((string) $this->client->getResponse()->headers->get('Location'), \PHP_URL_QUERY), $result);

        return $result;
    }

    public function testSsoWithValidProofCreatesTheUserAndKeepsTheSecretOutOfTheState(): void
    {
        $this->boot();
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $q = $this->ssoStart(['feed_id' => $feed->getId(), 'secret' => 'secret-abc']);
        $payload = (string) base64_decode(strtr(explode('.', $q['state'])[0], '-_', '+/'));
        $this->assertStringNotContainsString('secret-abc', $payload);
        $this->assertStringContainsString($feed->getId(), $payload);

        $result = $this->ssoCallback($q);
        $this->assertArrayHasKey('code', $result);
        $this->assertSame(1, $this->users('sso@example.com'));
    }

    public function testSsoWithoutOrInvalidProofIsRestricted(): void
    {
        $this->boot();
        $feed = $this->feed(FeedVisibility::PRIVATE);
        $this->setSignup(FeedSignup::INTERNAL);
        foreach ([[], ['feed_id' => $feed->getId()], ['feed_id' => $feed->getId(), 'secret' => 'wrong'], ['feed_id' => 'nope']] as $params) {
            $q = $this->ssoStart($params);
            $this->assertArrayHasKey('state', $q);
            $this->assertSame(['error' => 'registration_restricted'], $this->ssoCallback($q));
        }
        $this->assertSame(0, $this->users('sso@example.com'));
    }

    public function testSsoRevalidatesAtTheCallback(): void
    {
        $this->boot();
        $feed = $this->feed(FeedVisibility::CLUB);
        $q = $this->ssoStart(['feed_id' => $feed->getId()]);
        $this->setSignup(FeedSignup::OFF);
        $this->assertSame(['error' => 'registration_restricted'], $this->ssoCallback($q));

        $private = $this->feed(FeedVisibility::PRIVATE, 'old-secret');
        $this->setSignup(FeedSignup::INTERNAL);
        $q = $this->ssoStart(['feed_id' => $private->getId(), 'secret' => 'old-secret']);
        $this->em->getConnection()->executeStatement('UPDATE calendar_feed SET shared_secret = ? WHERE id = ?', ['rotated', $private->getId()]);
        $this->assertSame(['error' => 'registration_restricted'], $this->ssoCallback($q));
        $this->assertSame(0, $this->users('sso@example.com'));
    }
}
