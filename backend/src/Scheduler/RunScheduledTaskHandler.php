<?php

declare(strict_types=1);

namespace App\Scheduler;

use App\Repository\RefreshTokenRepository;
use App\Repository\SecurityEventRepository;
use App\Security\NonceStore;
use App\Service\AccountService;
use App\Service\ClubInvitationService;
use App\Service\FailedMessagePruner;
use App\Service\GeoIpUpdater;
use App\Service\GeoIpUpdateStatus;
use App\Service\HolidayRefreshService;
use App\Service\OAuthPruner;
use App\Service\PasswordResetService;
use App\Service\UnverifiedUserPruner;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

/**
 * Prune jobs let exceptions propagate (messenger retries, then the failure transport). The fetching jobs log and
 * swallow failures: a retry would fetch everything again and a partial failure is normal.
 */
#[AsMessageHandler]
final class RunScheduledTaskHandler
{
    public function __construct(
        private readonly UnverifiedUserPruner $unverifiedUsers,
        private readonly PasswordResetService $passwordResets,
        private readonly AccountService $accounts,
        private readonly RefreshTokenRepository $refreshTokens,
        private readonly ClubInvitationService $invitations,
        private readonly OAuthPruner $oauth,
        private readonly SecurityEventRepository $securityEvents,
        private readonly NonceStore $nonces,
        private readonly FailedMessagePruner $failedMessages,
        private readonly HolidayRefreshService $holidays,
        private readonly GeoIpUpdater $geoIp,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function __invoke(RunScheduledTask $message): void
    {
        match ($message->task) {
            ScheduledTask::PruneUnverifiedUsers => $this->unverifiedUsers->prune(),
            ScheduledTask::PrunePasswordResets => $this->prunePasswordResets(),
            ScheduledTask::PruneRefreshTokens => $this->refreshTokens->pruneEnded($this->clock->now()),
            ScheduledTask::PruneClubInvitations => $this->invitations->pruneOld(),
            ScheduledTask::PruneOAuth => $this->oauth->prune(),
            ScheduledTask::PruneSecurityEvents => $this->securityEvents->pruneBefore(
                $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->modify('-1 year'),
            ),
            ScheduledTask::PruneAuthNonces => $this->nonces->prune(),
            ScheduledTask::PruneFailedMessages => $this->failedMessages->prune(),
            ScheduledTask::HolidaysRefresh => $this->refreshHolidays(),
            ScheduledTask::GeoIpUpdate => $this->updateGeoIp(),
        };
    }

    private function prunePasswordResets(): void
    {
        $this->passwordResets->pruneExpired();
        $this->accounts->pruneExpiredEmailChanges();
    }

    private function refreshHolidays(): void
    {
        try {
            foreach ($this->holidays->refresh() as $result) {
                if (null !== $result->error) {
                    $this->logger->warning('Scheduled holiday refresh failed for a calendar.', ['exception' => $result->error::class]);
                }
            }
        } catch (\Throwable $e) {
            $this->logger->warning('Scheduled holiday refresh failed.', ['exception' => $e::class]);
        }
    }

    private function updateGeoIp(): void
    {
        try {
            $result = $this->geoIp->update();
        } catch (\Throwable $e) {
            $this->logger->warning('Scheduled GeoIP update failed.', ['exception' => $e::class]);

            return;
        }
        if (GeoIpUpdateStatus::Failed === $result->status) {
            $this->logger->warning('Scheduled GeoIP update failed.', ['exception' => null !== $result->error ? $result->error::class : null]);
        }
    }
}
