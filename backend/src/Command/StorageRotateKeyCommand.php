<?php

declare(strict_types=1);

namespace App\Command;

use App\Storage\S3KeyRotator;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Operator / entrypoint: re-encrypts S3 objects to the current SSE-C key. Rotation: S3_SSE_C_KEY=<new>,
 * S3_SSE_C_KEY_PREVIOUS=<old> (plus `plain` for unencrypted objects), run this, then drop S3_SSE_C_KEY_PREVIOUS.
 */
#[AsCommand(name: 'app:storage:rotate-key', description: 'Re-encrypt S3 objects with the current SSE-C key (S3_SSE_C_KEY_PREVIOUS lists the older keys)')]
class StorageRotateKeyCommand
{
    public function __construct(private readonly S3KeyRotator $rotator)
    {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Option('Only count, change nothing', name: 'dry-run')] bool $dryRun = false,
    ): int {
        try {
            $result = $this->rotator->rotate($dryRun);
        } catch (\Throwable $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }
        if (null !== $result->skipped) {
            $io->writeln('Nothing to do: '.$result->skipped.'.');

            return Command::SUCCESS;
        }

        $io->table(
            ['Checked', $dryRun ? 'Would rotate' : 'Rotated', 'Already current', 'Changed meanwhile', 'Unreadable', 'Too large'],
            [[$result->checked, $result->rotated, $result->current, $result->changedMeanwhile, count($result->unreadable), count($result->tooLarge)]],
        );
        if ([] !== $result->unreadable) {
            $io->error('No configured key opens these objects (add the missing key to S3_SSE_C_KEY_PREVIOUS): '.implode(', ', $result->unreadable));
        }
        if ([] !== $result->tooLarge) {
            $io->error('These objects exceed 5 GB and cannot be re-encrypted by a single copy: '.implode(', ', $result->tooLarge));
        }
        if ($result->failed()) {
            return Command::FAILURE;
        }
        $io->success($dryRun ? 'Dry run: nothing changed.' : 'All objects are encrypted with the current key. S3_SSE_C_KEY_PREVIOUS can be removed.');

        return Command::SUCCESS;
    }
}
