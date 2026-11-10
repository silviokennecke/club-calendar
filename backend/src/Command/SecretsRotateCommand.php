<?php

declare(strict_types=1);

namespace App\Command;

use App\Security\Secret\SecretRotator;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Operator / entrypoint: encrypts legacy plaintext secrets and re-encrypts values of older keys with the current
 * APP_SECRET. Rotation: APP_SECRET_PREVIOUS=<old>, APP_SECRET=<new>, run this, then drop APP_SECRET_PREVIOUS.
 */
#[AsCommand(name: 'app:secrets:rotate', description: 'Encrypt stored secrets (feeds, personal subscriptions) with the current APP_SECRET')]
class SecretsRotateCommand
{
    public function __construct(private readonly SecretRotator $rotator)
    {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Option('Only count, change nothing', name: 'dry-run')] bool $dryRun = false,
    ): int {
        $failed = false;
        $rows = [];
        foreach ($this->rotator->rotate($dryRun) as $r) {
            $rows[] = [$r['column'], $r['scanned'], $r['rewritten'], $r['current'], $r['changedMeanwhile'], count($r['failedIds'])];
            if ([] !== $r['failedIds']) {
                $failed = true;
                $io->error(sprintf('%s: cannot decrypt rows %s (missing old key in APP_SECRET_PREVIOUS, or damaged value).', $r['column'], implode(', ', $r['failedIds'])));
            }
        }
        $io->table(['Column', 'Scanned', $dryRun ? 'Would rewrite' : 'Rewritten', 'Already current', 'Changed meanwhile', 'Failed'], $rows);

        if ($failed) {
            return Command::FAILURE;
        }
        $io->success($dryRun ? 'Dry run: nothing changed.' : 'All secrets are encrypted with the current key.');

        return Command::SUCCESS;
    }
}
