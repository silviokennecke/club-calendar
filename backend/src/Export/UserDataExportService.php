<?php

declare(strict_types=1);

namespace App\Export;

use App\Entity\Calendar;
use App\Entity\CalendarFeed;
use App\Entity\Club;
use App\Entity\ClubInvitation;
use App\Entity\ClubUser;
use App\Entity\EmailChange;
use App\Entity\EmailVerification;
use App\Entity\Event;
use App\Entity\EventSeries;
use App\Entity\EventTemplate;
use App\Entity\Feature;
use App\Entity\FeedMember;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Entity\Location;
use App\Entity\McpGrant;
use App\Entity\McpToken;
use App\Entity\MemberSubscription;
use App\Entity\MemberSubscriptionFeed;
use App\Entity\MemberSubscriptionTargetGroup;
use App\Entity\MfaBackupCode;
use App\Entity\OAuthAccount;
use App\Entity\OAuthAuthorizationCode;
use App\Entity\OAuthAuthorizationRequest;
use App\Entity\Passkey;
use App\Entity\PasswordReset;
use App\Entity\Property;
use App\Entity\RefreshToken;
use App\Entity\SecurityEvent;
use App\Entity\StepUpCode;
use App\Entity\TargetGroup;
use App\Entity\User;
use App\Entity\UserConsent;
use App\Entity\UserTotp;
use App\OAuth\RedirectUriPolicy;
use Doctrine\DBAL\Connection;
use Symfony\Component\Clock\ClockInterface;

/**
 * Complete data export of one user (GDPR Art. 15/20) as streamed JSON.
 *
 * Every section reads explicit columns with plain SQL (no entity hydration, no secret column is ever selected),
 * so new columns never leak automatically and memory does not grow with the number of rows. Big lists are read
 * in keyset batches. Nothing about other people is included.
 */
final class UserDataExportService
{
    public const int VERSION = 1;
    public const string SCHEMA = 'club-calendar-user-export';
    public const int BATCH_SIZE = 500;

    /** What is deliberately not part of the export, shown to the user in `meta.excluded`. */
    public const array EXCLUDED = [
        'Password (hash) and the secret values of the sign-in methods (authenticator app secret, backup codes, passkey keys).',
        'Tokens, verification and reset codes, secret addresses of calendar feeds and of your personal subscription.',
        'Data of other people: member lists, invitees, other members of your clubs.',
        'Internal technical data (session counters, rate limits, caches).',
        'Contents of clubs that you did not change yourself (events, locations etc. are listed only where you were the last editor).',
    ];

    /**
     * Drift guard (UserDataExportCoverageTest): every entity that links to a user is either exported or excluded
     * on purpose. `exported:<section>` | `excluded:<reason>`.
     *
     * @var array<class-string, string>
     */
    public const array COVERAGE = [
        User::class => 'exported:account',
        ClubUser::class => 'exported:memberships',
        FeedMember::class => 'exported:feedAccess',
        MemberSubscription::class => 'exported:subscription',
        MemberSubscriptionFeed::class => 'exported:subscription',
        MemberSubscriptionTargetGroup::class => 'exported:subscription',
        UserTotp::class => 'exported:signInMethods',
        MfaBackupCode::class => 'exported:signInMethods',
        Passkey::class => 'exported:signInMethods',
        OAuthAccount::class => 'exported:signInMethods',
        UserConsent::class => 'exported:consents',
        SecurityEvent::class => 'exported:securityEvents',
        McpGrant::class => 'exported:connectedApps',
        RefreshToken::class => 'exported:sessions',
        ClubInvitation::class => 'exported:invitations',
        EmailChange::class => 'exported:pendingEmailChange',
        Club::class => 'exported:clubContent',
        Calendar::class => 'exported:clubContent',
        CalendarFeed::class => 'exported:clubContent',
        Event::class => 'exported:clubContent',
        EventSeries::class => 'exported:clubContent',
        EventTemplate::class => 'exported:clubContent',
        Property::class => 'exported:clubContent',
        Feature::class => 'exported:clubContent',
        TargetGroup::class => 'exported:clubContent',
        Location::class => 'exported:clubContent',
        HolidayCalendar::class => 'exported:clubContent',
        HolidayEvent::class => 'exported:clubContent',
        PasswordReset::class => 'excluded:secret reset token',
        EmailVerification::class => 'excluded:secret confirmation code',
        StepUpCode::class => 'excluded:secret confirmation code',
        McpToken::class => 'excluded:token hashes',
        OAuthAuthorizationCode::class => 'excluded:secret authorization code',
        OAuthAuthorizationRequest::class => 'excluded:short-lived technical request state',
    ];

    public function __construct(
        private readonly Connection $connection,
        private readonly ClubContentExporter $clubContent,
        private readonly ClockInterface $clock,
    ) {
    }

    /**
     * The export as JSON text pieces in order; join them (or echo them as they come) for the document.
     *
     * @return \Generator<int, string>
     */
    public function chunks(User $user): \Generator
    {
        $w = new JsonStreamWriter();
        $uid = $user->getId();
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));

        $w->beginObject();
        $w->key('meta')->value([
            'version' => self::VERSION,
            'schema' => self::SCHEMA,
            'generatedAt' => self::utc($now),
            'userId' => $uid,
            'excluded' => self::EXCLUDED,
        ]);
        $w->key('account')->value($this->account($user));
        $w->key('memberships')->value($this->memberships($uid));
        $w->key('feedAccess')->value($this->feedAccess($uid));
        $w->key('subscription')->value($this->subscriptions($uid));
        yield $w->flush();

        $w->key('signInMethods')->value($this->signInMethods($user));
        $w->key('consents')->value($this->consents($uid));
        yield $w->flush();

        $w->key('securityEvents')->beginArray();
        yield from $this->securityEvents($w, $uid);
        $w->endArray();

        $w->key('connectedApps')->value($this->connectedApps($uid));
        $w->key('sessions')->beginArray();
        yield from $this->sessions($w, $uid);
        $w->endArray();

        $w->key('invitations')->value($this->invitations($user));
        $w->key('pendingEmailChange')->value($this->pendingEmailChange($uid, $now));
        yield $w->flush();

        $w->key('clubContent');
        yield from $this->clubContent->write($w, $uid);

        $w->endObject();
        yield $w->flush();
    }

    /** @return array<string, mixed> */
    private function account(User $user): array
    {
        return [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
            'language' => $user->getLanguage(),
            'dateFormat' => $user->getDateFormat(),
            'firstDayOfWeek' => $user->getFirstDayOfWeek(),
            'lastClubId' => $user->getLastClubId(),
            'lastCalendarId' => $user->getLastCalendarId(),
            'emailVerified' => $user->isEmailVerified(),
            'createdAt' => self::utc($user->getCreatedAt()),
            'mfaEnforced' => $user->isMfaEnforced(),
            'mfaEnforcedAt' => self::utc($user->getMfaEnforcedAt()),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function memberships(string $uid): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT cu.club_id, c.name, cu.role, cu.last_calendar_id FROM club_user cu INNER JOIN club c ON c.id = cu.club_id
             WHERE cu.user_id = :u ORDER BY c.name, c.id',
            ['u' => $uid],
        );

        return array_map(static fn (array $r) => [
            'clubId' => $r['club_id'], 'clubName' => $r['name'], 'role' => $r['role'], 'lastCalendarId' => $r['last_calendar_id'],
        ], $rows);
    }

    /** @return list<array<string, mixed>> */
    private function feedAccess(string $uid): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT fm.feed_id, f.name, f.club_id, fm.source, fm.created_at FROM feed_member fm
             INNER JOIN calendar_feed f ON f.id = fm.feed_id WHERE fm.user_id = :u ORDER BY fm.created_at, fm.id',
            ['u' => $uid],
        );

        return array_map(static fn (array $r) => [
            'feedId' => $r['feed_id'], 'feedName' => $r['name'], 'clubId' => $r['club_id'],
            'source' => $r['source'], 'createdAt' => self::utc($r['created_at']),
        ], $rows);
    }

    /** One entry per club; the address secret is not selected. @return list<array<string, mixed>> */
    private function subscriptions(string $uid): array
    {
        $subs = $this->connection->fetchAllAssociative(
            'SELECT s.id, s.club_id, c.name AS club_name, s.updated_at FROM member_subscription s
             INNER JOIN club c ON c.id = s.club_id WHERE s.user_id = :u ORDER BY c.name, s.id',
            ['u' => $uid],
        );
        $out = [];
        foreach ($subs as $s) {
            $feeds = $this->connection->fetchAllAssociative(
                'SELECT f.id, f.name FROM member_subscription_feed sf INNER JOIN calendar_feed f ON f.id = sf.feed_id
                 WHERE sf.subscription_id = :s ORDER BY f.name, f.id',
                ['s' => $s['id']],
            );
            $groups = $this->connection->fetchAllAssociative(
                'SELECT g.id, g.name FROM member_subscription_target_group sg INNER JOIN target_group g ON g.id = sg.target_group_id
                 WHERE sg.subscription_id = :s ORDER BY g.name, g.id',
                ['s' => $s['id']],
            );
            $out[] = [
                'clubId' => $s['club_id'],
                'clubName' => $s['club_name'],
                'selectedFeeds' => array_map(static fn (array $f) => ['id' => $f['id'], 'name' => $f['name']], $feeds),
                'targetGroups' => array_map(static fn (array $g) => ['id' => $g['id'], 'name' => $g['name']], $groups),
                'updatedAt' => self::utc($s['updated_at']),
            ];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function signInMethods(User $user): array
    {
        $uid = $user->getId();
        $hasPassword = (bool) $this->connection->fetchOne('SELECT password IS NOT NULL FROM user WHERE id = :u', ['u' => $uid]);
        $totp = $this->connection->fetchOne('SELECT created_at FROM user_totp WHERE user_id = :u', ['u' => $uid]);
        $codes = $this->connection->fetchAssociative(
            'SELECT COUNT(*) AS total, COALESCE(SUM(used_at IS NULL), 0) AS unused FROM mfa_backup_code WHERE user_id = :u',
            ['u' => $uid],
        );
        $passkeys = $this->connection->fetchAllAssociative(
            'SELECT id, device_name, created_at, last_used_at FROM passkey WHERE user_id = :u ORDER BY created_at, id',
            ['u' => $uid],
        );
        $sso = $this->connection->fetchAllAssociative(
            'SELECT provider, provider_id, email, tenant_id, object_id FROM oauth_account WHERE user_id = :u ORDER BY provider, id',
            ['u' => $uid],
        );

        return [
            'password' => $hasPassword,
            'mfaEnforced' => $user->isMfaEnforced(),
            'totp' => false === $totp ? null : ['active' => true, 'createdAt' => self::utc($totp)],
            'backupCodes' => ['total' => (int) $codes['total'], 'unused' => (int) $codes['unused']],
            'passkeys' => array_map(static fn (array $p) => [
                'id' => $p['id'], 'deviceName' => $p['device_name'],
                'createdAt' => self::utc($p['created_at']), 'lastUsedAt' => self::utc($p['last_used_at']),
            ], $passkeys),
            'sso' => array_map(static fn (array $a) => [
                'provider' => $a['provider'], 'providerId' => $a['provider_id'], 'email' => $a['email'],
                'tenantId' => $a['tenant_id'], 'objectId' => $a['object_id'],
            ], $sso),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function consents(string $uid): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT type, document_id, consented_at, ip_address, user_agent FROM user_consent WHERE user_id = :u ORDER BY consented_at, id',
            ['u' => $uid],
        );

        return array_map(static fn (array $r) => [
            'documentType' => $r['type'], 'documentId' => $r['document_id'], 'consentedAt' => self::utc($r['consented_at']),
            'ipAddress' => $r['ip_address'], 'userAgent' => $r['user_agent'],
        ], $rows);
    }

    /** @return \Generator<int, string> */
    private function securityEvents(JsonStreamWriter $w, string $uid): \Generator
    {
        $sql = 'SELECT id, type, method, provider, success, attempts, ip, city, country, browser, user_agent, created_at
                FROM security_event WHERE user_id = :u AND (created_at > :c OR (created_at = :c AND id > :i))
                ORDER BY created_at, id LIMIT '.self::BATCH_SIZE;
        $cursor = ['c' => '1000-01-01 00:00:00', 'i' => ''];
        while (true) {
            $rows = $this->connection->executeQuery($sql, ['u' => $uid] + $cursor)->fetchAllAssociative();
            foreach ($rows as $r) {
                $w->value([
                    'type' => $r['type'], 'method' => $r['method'], 'provider' => $r['provider'], 'success' => (bool) $r['success'],
                    'attempts' => (int) $r['attempts'], 'ip' => $r['ip'], 'city' => $r['city'], 'country' => $r['country'],
                    'browser' => $r['browser'], 'userAgent' => $r['user_agent'], 'createdAt' => self::utc($r['created_at']),
                ]);
            }
            if ([] !== $rows) {
                yield $w->flush();
            }
            if (count($rows) < self::BATCH_SIZE) {
                return;
            }
            $last = $rows[array_key_last($rows)];
            $cursor = ['c' => $last['created_at'], 'i' => $last['id']];
        }
    }

    /** @return list<array<string, mixed>> */
    private function connectedApps(string $uid): array
    {
        $rows = $this->connection->fetchAllAssociative(
            'SELECT g.id, c.family, c.client_name, g.scopes, g.created_at, g.last_used_at, g.expires_at, g.revoked_at
             FROM mcp_grant g INNER JOIN oauth_client c ON c.id = g.client_id WHERE g.user_id = :u ORDER BY g.created_at, g.id',
            ['u' => $uid],
        );

        return array_map(static fn (array $r) => [
            'grantId' => $r['id'],
            'label' => RedirectUriPolicy::label($r['family']),
            'claimedName' => $r['client_name'],
            'scopes' => explode(' ', (string) $r['scopes']),
            'createdAt' => self::utc($r['created_at']),
            'lastUsedAt' => self::utc($r['last_used_at']),
            'expiresAt' => self::utc($r['expires_at']),
            'revokedAt' => self::utc($r['revoked_at']),
        ], $rows);
    }

    /** One entry per sign-in (token family); the family and token ids are not output. @return \Generator<int, string> */
    private function sessions(JsonStreamWriter $w, string $uid): \Generator
    {
        $sql = 'SELECT family_id, MIN(issued_at) AS started_at, MAX(issued_at) AS last_refreshed_at, MAX(expires_at) AS expires_at,
                       MAX(family_expires_at) AS family_expires_at, MAX(revoked_at) AS revoked_at
                FROM refresh_token WHERE user_id = :u AND family_id > :last GROUP BY family_id ORDER BY family_id LIMIT '.self::BATCH_SIZE;
        $last = '';
        while (true) {
            $rows = $this->connection->executeQuery($sql, ['u' => $uid, 'last' => $last])->fetchAllAssociative();
            foreach ($rows as $r) {
                $w->value([
                    'startedAt' => self::utc($r['started_at']), 'lastRefreshedAt' => self::utc($r['last_refreshed_at']),
                    'expiresAt' => self::utc($r['expires_at']), 'familyExpiresAt' => self::utc($r['family_expires_at']),
                    'revokedAt' => self::utc($r['revoked_at']),
                ]);
            }
            if ([] !== $rows) {
                yield $w->flush();
            }
            if (count($rows) < self::BATCH_SIZE) {
                return;
            }
            $last = (string) $rows[array_key_last($rows)]['family_id'];
        }
    }

    /** @return array<string, mixed> */
    private function invitations(User $user): array
    {
        $received = $this->connection->fetchAllAssociative(
            'SELECT c.name, i.role, i.status, i.created_at, i.expires_at, i.resolved_at FROM club_invitation i
             INNER JOIN club c ON c.id = i.club_id WHERE i.email = :e ORDER BY i.created_at, i.id',
            ['e' => $user->getEmail()],
        );
        $sent = (int) $this->connection->fetchOne('SELECT COUNT(*) FROM club_invitation WHERE invited_by_id = :u', ['u' => $user->getId()]);

        return [
            'received' => array_map(static fn (array $r) => [
                'clubName' => $r['name'], 'role' => $r['role'], 'status' => $r['status'],
                'createdAt' => self::utc($r['created_at']), 'expiresAt' => self::utc($r['expires_at']), 'resolvedAt' => self::utc($r['resolved_at']),
            ], $received),
            'sentCount' => $sent,
        ];
    }

    /** @return array<string, mixed>|null */
    private function pendingEmailChange(string $uid, \DateTimeImmutable $now): ?array
    {
        $row = $this->connection->fetchAssociative(
            'SELECT new_email, expires_at, created_at FROM email_change WHERE user_id = :u AND used_at IS NULL AND expires_at > :now
             ORDER BY created_at DESC LIMIT 1',
            ['u' => $uid, 'now' => $now->format('Y-m-d H:i:s')],
        );

        return false === $row ? null : [
            'newEmail' => $row['new_email'], 'expiresAt' => self::utc($row['expires_at']), 'createdAt' => self::utc($row['created_at']),
        ];
    }

    private static function utc(\DateTimeImmutable|string|null $value): ?string
    {
        if (null === $value) {
            return null;
        }
        $at = \is_string($value) ? new \DateTimeImmutable($value, new \DateTimeZone('UTC')) : $value->setTimezone(new \DateTimeZone('UTC'));

        return $at->format('Y-m-d\TH:i:s\Z');
    }
}
