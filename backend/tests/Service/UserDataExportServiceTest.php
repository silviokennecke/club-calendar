<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\ClubInvitation;
use App\Entity\FeedMember;
use App\Entity\McpGrant;
use App\Entity\McpToken;
use App\Entity\MemberSubscription;
use App\Entity\MemberSubscriptionFeed;
use App\Entity\MemberSubscriptionTargetGroup;
use App\Entity\MfaBackupCode;
use App\Entity\OAuthAccount;
use App\Entity\OAuthClient;
use App\Entity\Passkey;
use App\Entity\User;
use App\Entity\UserConsent;
use App\Entity\UserTotp;
use App\Enum\ClubRole;
use App\Enum\FeedVisibility;
use App\Enum\LegalDocumentType;
use App\Export\UserDataExportService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Uid\Uuid;

class UserDataExportServiceTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private Connection $conn;
    private UserPasswordHasherInterface $hasher;
    private UserDataExportService $export;

    /** @var list<string> values that must never appear in an export of the user */
    private array $forbidden = [];

    protected function setUp(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $this->em = $c->get(EntityManagerInterface::class);
        $this->conn = $this->em->getConnection();
        $this->hasher = $c->get(UserPasswordHasherInterface::class);
        $this->export = $c->get(UserDataExportService::class);
        DatabaseResetter::reset($this->em);
    }

    /** @return array<string, mixed> */
    private function exportOf(User $user, ?string &$raw = null): array
    {
        $pieces = iterator_to_array($this->export->chunks($user), false);
        $raw = implode('', $pieces);
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($data);

        return $data;
    }

    private function audit(string $table, string $id, User $by, string $at = '2026-03-01 10:00:00'): void
    {
        $this->conn->executeStatement("UPDATE `$table` SET updated_by_id = ?, updated_at = ? WHERE id = ?", [$by->getId(), $at, $id]);
    }

    public function testFullExportContainsOwnDataAndNoSecrets(): void
    {
        $a = TestHelper::createUser($this->em, $this->hasher, 'alice@example.com');
        $a->setName('Alice Exported');
        $a->setMfaEnforced(true);
        $b = TestHelper::createUser($this->em, $this->hasher, 'bertha.other@example.com');
        $b->setName('Bertha Other');
        $this->em->flush();
        $this->forbidden = [(string) $a->getPassword(), (string) $b->getPassword(), 'bertha.other@example.com', 'Bertha Other'];

        $club = TestHelper::createClub($this->em, $a, 'Alpha Club');
        $club2 = TestHelper::createClub($this->em, $b, 'Beta Club');
        TestHelper::addMember($this->em, $club, $b, ClubRole::EDITOR);
        TestHelper::addMember($this->em, $club2, $a, ClubRole::VIEWER);
        $cal = TestHelper::createCalendar($this->em, $club, 'Hauptkalender');
        $cal2 = TestHelper::createCalendar($this->em, $club2, 'Beta Kalender');
        $e1 = TestHelper::createEvent($this->em, $cal, ['name' => 'Sommerfest', 'date' => '2026-07-04']);
        $e2 = TestHelper::createEvent($this->em, $cal, ['name' => 'Training', 'date' => '2026-07-05']);
        $eB = TestHelper::createEvent($this->em, $cal, ['name' => 'Events by Bertha']);
        $prop2 = TestHelper::createProperty($this->em, $cal2, 'Beta Badge', '🎯');
        $loc = TestHelper::createLocation($this->em, $club, 'Halle Nord');
        $group = TestHelper::createTargetGroup($this->em, $club, 'Jugend');
        $feed = TestHelper::createFeed($this->em, $club, [$cal], FeedVisibility::PRIVATE, 'Privater Feed', 'FEED-SECRET-FORBIDDEN');
        $this->forbidden[] = 'FEED-SECRET-FORBIDDEN';

        $this->audit('event', $e1->getId(), $a, '2026-03-01 10:00:00');
        $this->audit('event', $e2->getId(), $a, '2026-03-02 11:30:00');
        $this->audit('event', $eB->getId(), $b);
        $this->audit('property', $prop2->getId(), $a, '2026-04-01 08:00:00');
        $this->audit('location', $loc->getId(), $a);
        // a changed b's membership row: exported without label and id
        $this->conn->executeStatement('UPDATE club_user SET updated_by_id = ?, updated_at = \'2026-03-01 10:00:00\' WHERE club_id = ? AND user_id = ?', [$a->getId(), $club->getId(), $b->getId()]);

        // feed access created by a for b, b's subscription updated by a
        $fm = new FeedMember($feed, $b, FeedMember::ASSIGNED, $a);
        $this->em->persist($fm);

        // own subscription
        $sub = new MemberSubscription($club, $a);
        $this->em->persist($sub);
        $this->em->persist(new MemberSubscriptionFeed($sub, $feed));
        $this->em->persist(new MemberSubscriptionTargetGroup($sub, $group));
        $this->forbidden[] = $sub->getSecret();

        // invitations: sent by a to a stranger; received by a from b
        $inv = new ClubInvitation($club, $a, 'invitee.stranger@example.com', 'INVITE-TOKEN-HASH-FORBIDDEN', new \DateTimeImmutable('2026-05-01 12:00:00'));
        $this->em->persist($inv);
        $inv2 = new ClubInvitation($club2, $b, 'alice@example.com', 'INVITE-TOKEN-HASH-2-FORBIDDEN', new \DateTimeImmutable('2026-05-02 12:00:00'));
        $inv2->setRole(ClubRole::VIEWER);
        $this->em->persist($inv2);
        $this->forbidden = [...$this->forbidden, 'invitee.stranger@example.com', 'INVITE-TOKEN-HASH-FORBIDDEN', 'INVITE-TOKEN-HASH-2-FORBIDDEN'];

        // sign-in methods
        $this->em->persist(new UserTotp($a, 'TOTPSECRETFORBIDDEN234567'));
        $this->forbidden[] = 'TOTPSECRETFORBIDDEN234567';
        $unused = new MfaBackupCode($a, '$2y$10$BACKUPHASHFORBIDDENxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
        $used = new MfaBackupCode($a, '$2y$10$BACKUPHASH2FORBIDDENxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
        $this->em->persist($unused);
        $this->em->persist($used);
        $this->forbidden = [...$this->forbidden, 'BACKUPHASHFORBIDDEN', 'BACKUPHASH2FORBIDDEN'];

        $pk = (new Passkey())->setId('pk-1')->setUser($a)->setCredentialId('CREDENTIAL-ID-FORBIDDEN')->setPublicKey('PUBLIC-KEY-FORBIDDEN')->setDeviceName('YubiKey')
            ->setCreatedAt(new \DateTimeImmutable('2026-02-01 09:00:00'))->setLastUsedAt(new \DateTimeImmutable('2026-02-02 09:00:00'));
        $this->em->persist($pk);
        $this->forbidden = [...$this->forbidden, 'CREDENTIAL-ID-FORBIDDEN', 'PUBLIC-KEY-FORBIDDEN'];

        $sso = (new OAuthAccount())->setUser($a)->setProvider('microsoft')->setProviderId('ms-sub-123')->setEmail('alice@work.example');
        $sso->setDirectoryIdentity('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
        $this->em->persist($sso);

        $doc = LegalTestHelper::publish($this->em, LegalDocumentType::PRIVACY);
        $this->em->persist(new UserConsent($a, $doc, new \DateTimeImmutable('2026-01-05 10:00:00'), '203.0.113.7', 'UA-Consent/1.0'));

        $client = new OAuthClient('Sneaky Name', ['https://claude.ai/api/mcp/auth_callback'], new \DateTimeImmutable('2026-01-01'), 'claude');
        $this->em->persist($client);
        $grant = new McpGrant($a, $client, 'mcp:read mcp:write', new \DateTimeImmutable('2026-06-10 10:00:00'), new \DateTimeImmutable('2026-07-10 10:00:00'));
        $this->em->persist($grant);
        $this->em->persist(new McpToken($grant, 'access', 'MCP-TOKEN-HASH-FORBIDDEN', new \DateTimeImmutable('2026-06-10'), new \DateTimeImmutable('2026-06-11')));
        $this->forbidden[] = 'MCP-TOKEN-HASH-FORBIDDEN';
        $this->em->flush();

        $this->conn->executeStatement('UPDATE mfa_backup_code SET used_at = ? WHERE id = ?', ['2026-06-01 00:00:00', $used->getId()]);

        // sessions: two families (one rotated twice), refresh token id must not appear
        $jti = Uuid::v7()->toRfc4122();
        $this->forbidden[] = $jti;
        foreach ([[$jti, 'fam-1', '2026-01-01 10:00:00'], [Uuid::v7()->toRfc4122(), 'fam-1', '2026-01-02 10:00:00'], [Uuid::v7()->toRfc4122(), 'fam-2', '2026-01-03 10:00:00']] as [$id, $fam, $at]) {
            $this->conn->insert('refresh_token', [
                'id' => $id, 'family_id' => $fam, 'user_id' => $a->getId(), 'issued_at' => $at,
                'expires_at' => '2026-02-01 00:00:00', 'family_expires_at' => '2026-03-01 00:00:00',
            ]);
        }

        // security events
        $this->conn->insert('security_event', [
            'id' => Uuid::v7()->toRfc4122(), 'user_id' => $a->getId(), 'type' => 'login', 'method' => 'password', 'provider' => null, 'success' => 0,
            'attempts' => 3, 'ip' => '198.51.100.9', 'city' => 'Köln', 'country' => 'DE', 'browser' => 'Firefox 130',
            'user_agent' => 'Mozilla/5.0 Full UA', 'dedupe_key' => str_repeat('a', 64), 'created_at' => '2026-02-01 08:00:00',
        ]);
        $this->conn->insert('security_event', [
            'id' => Uuid::v7()->toRfc4122(), 'user_id' => $b->getId(), 'type' => 'login', 'method' => 'password', 'success' => 1, 'attempts' => 1,
            'ip' => '192.0.2.222', 'created_at' => '2026-02-01 08:00:00',
        ]);
        $this->forbidden[] = '192.0.2.222';
        $this->forbidden[] = str_repeat('a', 64);

        // pending e-mail change, plus an expired one that must not show
        $this->conn->insert('email_change', ['id' => Uuid::v7()->toRfc4122(), 'user_id' => $a->getId(), 'new_email' => 'alice.new@example.com', 'token_hash' => 'EMAIL-CHANGE-HASH-FORBIDDEN', 'expires_at' => '2099-01-01 00:00:00', 'created_at' => '2026-06-01 00:00:00']);
        $this->conn->insert('email_change', ['id' => Uuid::v7()->toRfc4122(), 'user_id' => $a->getId(), 'new_email' => 'expired@example.com', 'token_hash' => 'EC2-FORBIDDEN', 'expires_at' => '2020-01-01 00:00:00', 'created_at' => '2019-12-31 00:00:00']);
        $this->forbidden = [...$this->forbidden, 'EMAIL-CHANGE-HASH-FORBIDDEN', 'EC2-FORBIDDEN', 'expired@example.com'];

        $this->em->clear();
        $a = $this->em->find(User::class, $a->getId());

        $data = $this->exportOf($a, $raw);

        self::assertSame(
            ['meta', 'account', 'memberships', 'feedAccess', 'subscription', 'signInMethods', 'consents', 'securityEvents', 'connectedApps', 'sessions', 'invitations', 'pendingEmailChange', 'clubContent'],
            array_keys($data),
        );
        self::assertSame(1, $data['meta']['version']);
        self::assertSame('club-calendar-user-export', $data['meta']['schema']);
        self::assertSame($a->getId(), $data['meta']['userId']);
        self::assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $data['meta']['generatedAt']);
        self::assertNotEmpty($data['meta']['excluded']);

        self::assertSame('Alice Exported', $data['account']['name']);
        self::assertSame('alice@example.com', $data['account']['email']);
        self::assertTrue($data['account']['mfaEnforced']);
        self::assertTrue($data['account']['emailVerified']);

        self::assertSame(['Alpha Club', 'Beta Club'], array_column($data['memberships'], 'clubName'));
        self::assertSame('admin', $data['memberships'][0]['role']);
        self::assertSame('viewer', $data['memberships'][1]['role']);

        self::assertSame([], $data['feedAccess']); // the feed member row is b's

        self::assertCount(1, $data['subscription']);
        self::assertSame($club->getId(), $data['subscription'][0]['clubId']);
        self::assertSame([['id' => $feed->getId(), 'name' => 'Privater Feed']], $data['subscription'][0]['selectedFeeds']);
        self::assertSame([['id' => $group->getId(), 'name' => 'Jugend']], $data['subscription'][0]['targetGroups']);

        $sign = $data['signInMethods'];
        self::assertTrue($sign['password']);
        self::assertTrue($sign['mfaEnforced']);
        self::assertTrue($sign['totp']['active']);
        self::assertSame(['total' => 2, 'unused' => 1], $sign['backupCodes']);
        self::assertSame([['id' => 'pk-1', 'deviceName' => 'YubiKey', 'createdAt' => '2026-02-01T09:00:00Z', 'lastUsedAt' => '2026-02-02T09:00:00Z']], $sign['passkeys']);
        self::assertSame([['provider' => 'microsoft', 'providerId' => 'ms-sub-123', 'email' => 'alice@work.example', 'tenantId' => '11111111-1111-1111-1111-111111111111', 'objectId' => '22222222-2222-2222-2222-222222222222']], $sign['sso']);

        self::assertSame([['documentType' => 'privacy', 'documentId' => $doc->getId(), 'consentedAt' => '2026-01-05T10:00:00Z', 'ipAddress' => '203.0.113.7', 'userAgent' => 'UA-Consent/1.0']], $data['consents']);

        self::assertCount(1, $data['securityEvents']);
        self::assertSame(
            ['type' => 'login', 'method' => 'password', 'provider' => null, 'success' => false, 'attempts' => 3, 'ip' => '198.51.100.9', 'city' => 'Köln', 'country' => 'DE', 'browser' => 'Firefox 130', 'userAgent' => 'Mozilla/5.0 Full UA', 'createdAt' => '2026-02-01T08:00:00Z'],
            $data['securityEvents'][0],
        );

        self::assertCount(1, $data['connectedApps']);
        $app = $data['connectedApps'][0];
        self::assertSame('Claude', $app['label']);
        self::assertSame('Sneaky Name', $app['claimedName']);
        self::assertSame(['mcp:read', 'mcp:write'], $app['scopes']);
        self::assertNull($app['revokedAt']);
        self::assertSame('2026-07-10T10:00:00Z', $app['expiresAt']);

        self::assertCount(2, $data['sessions']);
        self::assertSame('2026-01-01T10:00:00Z', $data['sessions'][0]['startedAt']);
        self::assertSame('2026-01-02T10:00:00Z', $data['sessions'][0]['lastRefreshedAt']);

        self::assertSame(1, $data['invitations']['sentCount']);
        self::assertCount(1, $data['invitations']['received']);
        self::assertSame('Beta Club', $data['invitations']['received'][0]['clubName']);
        self::assertSame('viewer', $data['invitations']['received'][0]['role']);
        self::assertSame('pending', $data['invitations']['received'][0]['status']);

        self::assertSame('alice.new@example.com', $data['pendingEmailChange']['newEmail']);

        $content = $data['clubContent'];
        self::assertSame(['Alpha Club', 'Beta Club'], array_column($content, 'clubName'));
        $alpha = $content[0]['entities'];
        self::assertSame([$e1->getId(), $e2->getId()], array_column($alpha['event'], 'id'));
        self::assertSame(
            ['type' => 'event', 'id' => $e1->getId(), 'name' => 'Sommerfest', 'relation' => 'lastUpdatedBy', 'at' => '2026-03-01T10:00:00Z', 'date' => '2026-07-04', 'calendarId' => $cal->getId(), 'calendarName' => 'Hauptkalender'],
            $alpha['event'][0],
        );
        self::assertSame('Halle Nord', $alpha['location'][0]['name']);
        self::assertSame(['type' => 'clubMember', 'id' => null, 'name' => null, 'relation' => 'lastUpdatedBy', 'at' => '2026-03-01T10:00:00Z'], $alpha['clubMember'][0]);
        self::assertCount(1, $alpha['clubInvitation']);
        self::assertSame('createdBy', $alpha['clubInvitation'][0]['relation']);
        self::assertSame('2026-05-01T12:00:00Z', $alpha['clubInvitation'][0]['at']);
        self::assertNull($alpha['clubInvitation'][0]['name']);
        self::assertSame('createdBy', $alpha['feedMember'][0]['relation']);
        self::assertSame('Privater Feed', $alpha['feedMember'][0]['name']);
        self::assertArrayNotHasKey('property', $alpha);
        self::assertSame(['property'], array_keys($content[1]['entities']));
        self::assertSame('Beta Badge', $content[1]['entities']['property'][0]['name']);
        self::assertSame('2026-04-01T08:00:00Z', $content[1]['entities']['property'][0]['at']);

        foreach ($this->forbidden as $value) {
            self::assertNotSame('', $value);
            self::assertStringNotContainsString($value, $raw, "export leaks: $value");
        }
        self::assertStringNotContainsString($e1->getId().'x', $raw);
        self::assertStringNotContainsString('Events by Bertha', $raw);
        self::assertStringNotContainsString($eB->getId(), $raw);
        self::assertStringNotContainsString($b->getId(), $raw);
    }

    public function testNothingOfOtherUsersAndEmptyUser(): void
    {
        $a = TestHelper::createUser($this->em, $this->hasher, 'solo@example.com');
        $b = TestHelper::createUser($this->em, $this->hasher, 'busy@example.com');
        $club = TestHelper::createClub($this->em, $b, 'Busy Club');
        $cal = TestHelper::createCalendar($this->em, $club);
        $e = TestHelper::createEvent($this->em, $cal, ['name' => 'Busy Event']);
        $this->audit('event', $e->getId(), $b);
        $this->conn->insert('security_event', ['id' => Uuid::v7()->toRfc4122(), 'user_id' => $b->getId(), 'type' => 'login', 'success' => 1, 'attempts' => 1, 'created_at' => '2026-01-01 00:00:00']);

        $data = $this->exportOf($a, $raw);

        self::assertSame([], $data['memberships']);
        self::assertSame([], $data['clubContent']);
        self::assertSame([], $data['securityEvents']);
        self::assertSame([], $data['sessions']);
        self::assertSame([], $data['connectedApps']);
        self::assertSame(['received' => [], 'sentCount' => 0], $data['invitations']);
        self::assertNull($data['pendingEmailChange']);
        self::assertNull($data['signInMethods']['totp']);
        self::assertSame(['total' => 0, 'unused' => 0], $data['signInMethods']['backupCodes']);
        self::assertStringNotContainsString('Busy', $raw);
        self::assertStringNotContainsString('busy@example.com', $raw);
    }

    public function testBatchingAcrossBatchBoundaries(): void
    {
        $a = TestHelper::createUser($this->em, $this->hasher);
        $club = TestHelper::createClub($this->em, $a, 'Big Club');
        $cal = TestHelper::createCalendar($this->em, $club);
        $n = 1100;
        $this->conn->beginTransaction();
        for ($i = 0; $i < $n; ++$i) {
            $this->conn->insert('event', [
                'id' => Uuid::v7()->toRfc4122(), 'calendar_id' => $cal->getId(), 'name' => "E$i", 'date' => '2026-07-01', 'time_begin' => '18:00', 'time_end' => '19:00',
                'is_all_day' => 0, 'is_draft' => 0, 'updated_at' => '2026-03-01 10:00:00', 'updated_by_id' => $a->getId(),
            ]);
            // same timestamp on purpose: the keyset must tie-break on the id
            $this->conn->insert('security_event', ['id' => Uuid::v7()->toRfc4122(), 'user_id' => $a->getId(), 'type' => 'login', 'success' => 1, 'attempts' => 1, 'created_at' => '2026-01-01 00:00:00']);
        }
        $this->conn->commit();

        $data = $this->exportOf($a);

        self::assertCount($n, $data['securityEvents']);
        $events = $data['clubContent'][0]['entities']['event'];
        self::assertCount($n, $events);
        self::assertCount($n, array_unique(array_column($events, 'id')));
    }

    public function testChunksAreSeveralPiecesAndValidJson(): void
    {
        $a = TestHelper::createUser($this->em, $this->hasher);
        TestHelper::createClub($this->em, $a);
        $pieces = iterator_to_array($this->export->chunks($a), false);
        self::assertGreaterThan(3, count($pieces));
        self::assertNotContains('', $pieces);
        json_decode(implode('', $pieces), false, 512, JSON_THROW_ON_ERROR);
    }
}
