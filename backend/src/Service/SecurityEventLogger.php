<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Security\ClientContext;
use App\Security\ClientContextResolver;
use App\Security\NonceStore;
use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Writes the security event log (login kinds, MFA steps, account-security changes). Plain DBAL inserts
 * in their own statements, so a caller's unit of work is neither flushed nor affected, and errors are
 * logged and swallowed: the log never breaks the flow it observes.
 *
 * Failures are attacker-writable (anyone who knows an address), so they are folded: same user, type,
 * method, provider and IP within an hour increment `attempts` of one row; at most FAILURE_ROWS_PER_DAY
 * failure rows per user and UTC day, beyond that the newest failure row only counts up.
 *
 * From the 3rd failed attempt of the same kind (user, type, method, provider) within an hour the user
 * gets one notification mail, then at most one per user, type and method per 24 hours.
 */
class SecurityEventLogger
{
    public const FAILURE_ROWS_PER_DAY = 50;
    public const MAIL_THRESHOLD = 3;
    private const MAIL_PURPOSE = 'security_failure_mail';
    private const MAIL_INTERVAL = 86400;
    private const MAX_ATTEMPTS = 65535;

    public function __construct(
        private readonly Connection $connection,
        private readonly ClockInterface $clock,
        private readonly ClientContextResolver $contextResolver,
        private readonly NonceStore $nonces,
        private readonly AccountMailer $mailer,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function record(
        User $user,
        SecurityEventType $type,
        bool $success,
        ?string $method = null,
        ?string $provider = null,
        ?ClientContext $context = null,
    ): void {
        try {
            $context ??= $this->contextResolver->current();
            $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
            if ($success) {
                $this->insert($user, $type, true, $method, $provider, $context, $now);

                return;
            }
            $this->recordFailure($user, $type, $method, $provider, $context, $now);
        } catch (\Throwable $e) {
            $this->logger->error('Security event could not be recorded', ['error' => $e::class, 'type' => $type->value]);
        }
    }

    private function recordFailure(User $user, SecurityEventType $type, ?string $method, ?string $provider, ClientContext $context, \DateTimeImmutable $now): void
    {
        $hourAgo = $now->modify('-1 hour')->format('Y-m-d H:i:s');
        $kindSql = 'user_id = ? AND type = ? AND success = 0 AND method <=> ? AND provider <=> ?';
        $kind = [$user->getId(), $type->value, $method, $provider];

        $updated = $this->connection->executeStatement(
            'UPDATE security_event SET attempts = LEAST(attempts + 1, '.self::MAX_ATTEMPTS.") WHERE $kindSql AND ip <=> ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
            [...$kind, $context->ip, $hourAgo],
        );
        if (0 === $updated) {
            $dayStart = $now->setTime(0, 0)->format('Y-m-d H:i:s');
            $today = (int) $this->connection->fetchOne(
                'SELECT COUNT(*) FROM security_event WHERE user_id = ? AND success = 0 AND created_at >= ?',
                [$user->getId(), $dayStart],
            );
            if ($today >= self::FAILURE_ROWS_PER_DAY) {
                $this->connection->executeStatement(
                    'UPDATE security_event SET attempts = LEAST(attempts + 1, '.self::MAX_ATTEMPTS.') WHERE user_id = ? AND success = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 1',
                    [$user->getId(), $dayStart],
                );
            } else {
                $this->insert($user, $type, false, $method, $provider, $context, $now);
            }
        }

        $total = (int) $this->connection->fetchOne(
            "SELECT COALESCE(SUM(attempts), 0) FROM security_event WHERE $kindSql AND created_at > ?",
            [...$kind, $hourAgo],
        );
        if ($total >= self::MAIL_THRESHOLD) {
            $this->notify($user, $type, $method, $context, $total, $now);
        }
    }

    private function notify(User $user, SecurityEventType $type, ?string $method, ClientContext $context, int $count, \DateTimeImmutable $now): void
    {
        $key = $user->getId().'|'.$type->value.'|'.($method ?? '');
        // NonceStore keeps an entry 60 s past the given time
        if ($this->nonces->consume(self::MAIL_PURPOSE, $key, $now->getTimestamp() + self::MAIL_INTERVAL - 60)) {
            $this->mailer->sendFailedSignIns($user, $context, $count);
        }
    }

    private function insert(User $user, SecurityEventType $type, bool $success, ?string $method, ?string $provider, ClientContext $context, \DateTimeImmutable $now): void
    {
        $this->connection->insert('security_event', [
            'id' => Uuid::v7()->toRfc4122(),
            'user_id' => $user->getId(),
            'type' => $type->value,
            'method' => $method,
            'provider' => $provider,
            'success' => $success ? 1 : 0,
            'attempts' => 1,
            'ip' => null !== $context->ip ? substr($context->ip, 0, 45) : null,
            'city' => null !== $context->city ? mb_substr($context->city, 0, 100) : null,
            'country' => null !== $context->country ? substr($context->country, 0, 2) : null,
            'browser' => null !== $context->browser ? mb_substr($context->browser, 0, 100) : null,
            'created_at' => $now->format('Y-m-d H:i:s'),
        ]);
    }
}
