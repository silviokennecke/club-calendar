<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Doctrine\Type\EncryptedSecretType;
use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\MemberSubscription;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Security\Secret\EncryptedColumns;
use App\Security\Secret\SecretCipher;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Feed and subscription secrets are ciphertext in the database and plaintext everywhere else. */
class EncryptedSecretsTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private static UserPasswordHasherInterface $hasher;
    private static TokenService $tokens;

    private User $admin;
    private Club $club;
    private Calendar $calendar;
    private string $base;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        self::$tokens = static::getContainer()->get(TokenService::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        $this->admin = TestHelper::createUser(self::$em, self::$hasher, 'admin@example.com');
        $this->club = TestHelper::createClub(self::$em, $this->admin);
        $this->calendar = TestHelper::createCalendar(self::$em, $this->club);
        $this->base = '/api/clubs/'.$this->club->getId();
    }

    private function req(User $who, string $method, string $uri, array $body = []): array
    {
        return TestHelper::jsonRequest(self::$client, $method, $uri, $body, TestHelper::authHeader($who, self::$tokens));
    }

    private function raw(string $sql, array $params = []): mixed
    {
        return self::$em->getConnection()->fetchOne($sql, $params);
    }

    public function testFeedSecretIsCiphertextInTheDatabaseAndPlaintextInTheApi(): void
    {
        $r = $this->req($this->admin, 'POST', $this->base.'/feeds?includeSecret=1', ['name' => 'F', 'visibility' => 'PRIVATE', 'calendarIds' => [$this->calendar->getId()]]);
        $this->assertSame(201, $r['status'], $r['content']);
        $secret = $r['body']['sharedSecret'];
        $id = $r['body']['id'];
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $secret);

        $stored = $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$id]);
        $this->assertStringStartsWith('enc:v1:', $stored);
        $this->assertStringNotContainsString($secret, $stored);

        $this->assertSame($secret, $this->req($this->admin, 'GET', $this->base."/feeds/$id?includeSecret=1", [])['body']['sharedSecret']);
        $this->assertArrayNotHasKey('sharedSecret', $this->req($this->admin, 'GET', $this->base."/feeds/$id")['body']);

        self::$client->request('GET', "/api/feed/$id/ics");
        $this->assertSame(403, self::$client->getResponse()->getStatusCode());
        self::$client->request('GET', "/api/feed/$id/ics?secret=wrong");
        $this->assertSame(403, self::$client->getResponse()->getStatusCode());
        self::$client->request('GET', "/api/feed/$id/ics?secret=$secret");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());

        $new = $this->req($this->admin, 'POST', $this->base."/feeds/$id/regenerate-secret?includeSecret=1")['body']['sharedSecret'];
        $this->assertNotSame($secret, $new);
        $this->assertStringStartsWith('enc:v1:', $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$id]));
        self::$client->request('GET', "/api/feed/$id/ics?secret=$secret");
        $this->assertSame(403, self::$client->getResponse()->getStatusCode());
        self::$client->request('GET', "/api/feed/$id/ics?secret=$new");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
    }

    public function testLegacyPlaintextFeedSecretStillWorksAndIsEncryptedOnNextWrite(): void
    {
        $feed = TestHelper::createFeed(self::$em, self::$em->find(Club::class, $this->club->getId()), [self::$em->find(Calendar::class, $this->calendar->getId())], FeedVisibility::PRIVATE, 'Legacy');
        $id = $feed->getId();
        self::$em->getConnection()->executeStatement('UPDATE calendar_feed SET shared_secret = ? WHERE id = ?', ['legacy-plain', $id]);
        self::$em->clear();

        self::$client->request('GET', "/api/feed/$id/ics?secret=legacy-plain");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        $this->assertSame('legacy-plain', $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$id]));

        $loaded = self::$em->find(CalendarFeed::class, $id);
        $loaded->setSharedSecret('legacy-plain-2');
        self::$em->flush();
        $this->assertStringStartsWith('enc:v1:', $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$id]));
        self::$em->clear();
        $this->assertSame('legacy-plain-2', self::$em->find(CalendarFeed::class, $id)->getSharedSecret());
    }

    public function testUnchangedEntitiesAreNotRewrittenByFlush(): void
    {
        $feed = TestHelper::createFeed(self::$em, self::$em->find(Club::class, $this->club->getId()), [self::$em->find(Calendar::class, $this->calendar->getId())]);
        $before = $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$feed->getId()]);
        self::$em->clear();
        $loaded = self::$em->find(CalendarFeed::class, $feed->getId());
        $loaded->setName('Renamed');
        self::$em->flush();
        $this->assertSame($before, $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$feed->getId()]));
    }

    public function testPersonalSubscriptionSecretEndToEnd(): void
    {
        $member = TestHelper::createUser(self::$em, self::$hasher, 'm@example.com');
        TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $member, ClubRole::MEMBER);
        $feed = TestHelper::createFeed(self::$em, self::$em->find(Club::class, $this->club->getId()), [self::$em->find(Calendar::class, $this->calendar->getId())], FeedVisibility::CLUB, 'Open');

        $sub = $this->req($member, 'GET', $this->base.'/my-subscription')['body'];
        $stored = $this->raw('SELECT secret FROM member_subscription WHERE id = ?', [$sub['id']]);
        $this->assertStringStartsWith('enc:v1:', $stored);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $sub['secret']);

        $this->assertSame(200, $this->req($member, 'PUT', $this->base.'/my-subscription', ['feedIds' => [$feed->getId()], 'targetGroupIds' => []])['status']);
        self::$client->request('GET', "/api/feed/me/{$sub['id']}/ics?secret={$sub['secret']}");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
        self::$client->request('GET', "/api/feed/me/{$sub['id']}/ics?secret=".substr($stored, 0, 60));
        $this->assertSame(404, self::$client->getResponse()->getStatusCode());

        $rotated = $this->req($member, 'POST', $this->base.'/my-subscription/rotate-secret')['body']['secret'];
        $this->assertStringStartsWith('enc:v1:', $this->raw('SELECT secret FROM member_subscription WHERE id = ?', [$sub['id']]));
        self::$client->request('GET', "/api/feed/me/{$sub['id']}/ics?secret={$sub['secret']}");
        $this->assertSame(404, self::$client->getResponse()->getStatusCode());
        self::$client->request('GET', "/api/feed/me/{$sub['id']}/ics?secret=$rotated");
        $this->assertSame(200, self::$client->getResponse()->getStatusCode());
    }

    public function testPurposesAreNotInterchangeableInTheDatabase(): void
    {
        $member = TestHelper::createUser(self::$em, self::$hasher, 'm@example.com');
        TestHelper::addMember(self::$em, self::$em->find(Club::class, $this->club->getId()), $member, ClubRole::MEMBER);
        $feed = TestHelper::createFeed(self::$em, self::$em->find(Club::class, $this->club->getId()), [self::$em->find(Calendar::class, $this->calendar->getId())]);
        $sub = $this->req($member, 'GET', $this->base.'/my-subscription')['body'];

        $feedCipher = $this->raw('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$feed->getId()]);
        self::$em->getConnection()->executeStatement('UPDATE member_subscription SET secret = ? WHERE id = ?', [$feedCipher, $sub['id']]);
        self::$em->clear();

        $this->expectException(\App\Security\Secret\SecretCipherException::class);
        self::$em->find(MemberSubscription::class, $sub['id']);
    }

    public function testEveryEncryptedMappedFieldIsRegisteredForRotation(): void
    {
        $registered = array_map(fn ($c) => $c->label(), EncryptedColumns::all());
        $found = [];
        foreach (self::$em->getMetadataFactory()->getAllMetadata() as $meta) {
            foreach ($meta->fieldMappings as $name => $mapping) {
                if (str_starts_with((string) $mapping->type, 'encrypted_')) {
                    $found[] = $meta->getTableName().'.'.$mapping->columnName;
                }
            }
        }
        sort($found);
        sort($registered);
        $this->assertSame($registered, $found);
        $this->assertInstanceOf(\Closure::class, (new \ReflectionClass(EncryptedSecretType::class))->getProperty('cipherProvider')->getValue());
        $this->assertInstanceOf(SecretCipher::class, static::getContainer()->get(SecretCipher::class));
    }
}
