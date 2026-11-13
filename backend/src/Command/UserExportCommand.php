<?php

declare(strict_types=1);

namespace App\Command;

use App\Enum\SecurityEventType;
use App\Export\UserDataExportService;
use App\Security\ClientContext;
use App\Service\SecurityEventLogger;
use App\Service\UserLookup;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

/**
 * Operator data export (GDPR Art. 15/20) for users who cannot use the profile action. Same content as the
 * profile export; writes to a file (0600, temp file + rename, so a failure leaves nothing behind) or to stdout.
 * Records a data_export security event (method cli) after a complete write; no mail, no rate limit.
 */
#[AsCommand(name: 'app:user:export', description: 'Export all personal data of a user as JSON (file or stdout)')]
class UserExportCommand
{
    public function __construct(
        private readonly UserLookup $users,
        private readonly UserDataExportService $export,
        private readonly SecurityEventLogger $events,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        OutputInterface $output,
        #[Argument('User id (UUID) or e-mail address')] string $user,
        #[Option('Write the JSON to this file instead of stdout', name: 'output')] ?string $file = null,
        #[Option('Overwrite an existing output file')] bool $force = false,
    ): int {
        $err = $io->getErrorStyle();
        $found = $this->users->find($user);
        if (null === $found) {
            $err->error('No user with this id or e-mail address.');

            return Command::FAILURE;
        }

        $path = $file;
        $tmp = null;
        try {
            if (null === $path) {
                foreach ($this->export->chunks($found) as $chunk) {
                    $output->write($chunk, false, OutputInterface::OUTPUT_RAW);
                }
            } else {
                if (file_exists($path) && !$force) {
                    $err->error(sprintf('%s already exists; use --force to overwrite it.', $path));

                    return Command::FAILURE;
                }
                $dir = \dirname($path);
                $tmp = is_dir($dir) ? tempnam($dir, '.export-') : false; // created with mode 0600
                if (false === $tmp || false === ($fh = fopen($tmp, 'wb'))) {
                    $err->error(sprintf('Cannot write to directory %s.', $dir));

                    return Command::FAILURE;
                }
                foreach ($this->export->chunks($found) as $chunk) {
                    if (false === fwrite($fh, $chunk)) {
                        throw new \RuntimeException('Write failed.');
                    }
                }
                if (!fclose($fh) || !rename($tmp, $path)) {
                    throw new \RuntimeException('Could not finish the file.');
                }
                $tmp = null;
            }
        } catch (\Throwable $e) {
            $err->error('Export failed: '.$e->getMessage());

            return Command::FAILURE;
        } finally {
            if (null !== $tmp && file_exists($tmp)) {
                @unlink($tmp);
            }
        }

        $this->events->record($found, SecurityEventType::DATA_EXPORT, true, 'cli', null, new ClientContext());
        $err->warning('The export contains personal data. Hand it over only through a secure channel and delete it afterwards.');

        return Command::SUCCESS;
    }
}
