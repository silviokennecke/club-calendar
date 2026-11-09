<?php

declare(strict_types=1);

namespace App\Command;

use App\Entity\User;
use App\Opaque\OpaqueRollout;
use App\Service\AccountMailer;
use App\Service\DeferredMailer;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Clock\ClockInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Reminder mails before OPAQUE_LEGACY_CUTOFF (docs/ops/OPAQUE-PLAN.md 6.5, 9): 14 and 3 days ahead, to confirmed
 * accounts that still have only a bcrypt hash. The command decides by date; `user.opaque_reminder_days` makes it
 * idempotent (each stage once per account, a missed stage is skipped). Run it daily.
 */
#[AsCommand(name: 'app:opaque:notify-legacy', description: 'Mail the cutoff reminders (14 and 3 days before) to accounts without an OPAQUE record')]
class OpaqueNotifyLegacyCommand
{
    private const array STAGES = [3, 14];

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly OpaqueRollout $rollout,
        private readonly AccountMailer $mailer,
        private readonly DeferredMailer $deferredMailer,
        private readonly ClockInterface $clock,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Option(description: 'Count the recipients, send nothing and store nothing')] bool $dryRun = false,
        #[Option(description: 'Maximum number of mails per run (the rest follows at the next run)')] int $limit = 500,
    ): int {
        $cutoff = $this->rollout->cutoff();
        if (!$this->rollout->isEnabled() || null === $cutoff) {
            $io->warning('OPAQUE_ENABLED is off or OPAQUE_LEGACY_CUTOFF is empty: nothing to remind.');

            return Command::SUCCESS;
        }
        if ($this->rollout->percent() < 100) {
            $io->error('OPAQUE_ROLLOUT_PERCENT is below 100 while a cutoff is set: refusing to remind accounts that are not offered the upgrade.');

            return Command::FAILURE;
        }
        $today = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->setTime(0, 0);
        if ($today >= $cutoff) {
            $io->writeln('The cutoff is reached: no reminders.');

            return Command::SUCCESS;
        }
        $daysLeft = (int) $today->diff($cutoff)->days;
        $stage = null;
        foreach (self::STAGES as $candidate) {
            if ($daysLeft <= $candidate) {
                $stage = $candidate;
                break;
            }
        }
        if (null === $stage) {
            $io->writeln(sprintf('%d days to the cutoff: the first reminder is due 14 days before.', $daysLeft));

            return Command::SUCCESS;
        }

        $query = $this->em->createQueryBuilder()
            ->select('u')->from(User::class, 'u')
            ->where('u.password IS NOT NULL')
            ->andWhere('u.opaqueRecord IS NULL')
            ->andWhere('u.isEmailVerified = true')
            ->andWhere('u.opaqueReminderDays IS NULL OR u.opaqueReminderDays > :stage')
            ->setParameter('stage', $stage)
            ->orderBy('u.id')
            ->setMaxResults(max(1, $limit))
            ->getQuery();
        /** @var list<User> $users */
        $users = $query->getResult();

        foreach ($users as $user) {
            if ($dryRun) {
                continue;
            }
            $this->mailer->sendOpaqueLegacyReminder($user, $cutoff);
            $user->setOpaqueReminderDays($stage);
        }
        if (!$dryRun) {
            $this->em->flush();
            $this->deferredMailer->flush();
        }
        $io->success(sprintf('%s %d reminder(s) for the %d-day stage (cutoff %s).', $dryRun ? 'Would send' : 'Sent', count($users), $stage, $cutoff->format('Y-m-d')));

        return Command::SUCCESS;
    }
}
