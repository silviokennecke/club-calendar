<?php

declare(strict_types=1);

namespace App\Command;

use App\Dto\Auth\RegisterDto;
use App\Opaque\OpaqueRollout;
use Psr\Clock\ClockInterface;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\StreamableInputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * Shared input handling of the user administration commands. Values are validated with the constraints of
 * {@see RegisterDto}, the DTO of POST /api/auth/register.
 */
trait PasswordInputTrait
{
    /** First violation message of a RegisterDto property, null if the value is valid. */
    private function violation(ValidatorInterface $validator, string $property, string $value): ?string
    {
        $dto = new RegisterDto();
        $dto->{$property} = $value;
        $violations = $validator->validateProperty($dto, $property);

        return \count($violations) > 0 ? (string) $violations->get(0)->getMessage() : null;
    }

    /**
     * Password from --password, --password-stdin or (interactive) a hidden prompt asked twice. Prints the
     * error and returns null if there is none or it is invalid.
     */
    private function readPassword(
        SymfonyStyle $io,
        InputInterface $input,
        ValidatorInterface $validator,
        ?string $password,
        bool $passwordStdin,
    ): ?string {
        if (null !== $password && $passwordStdin) {
            $io->error('Use either --password or --password-stdin, not both.');

            return null;
        }
        if ($passwordStdin) {
            $stream = $input instanceof StreamableInputInterface ? $input->getStream() : null;
            $line = fgets($stream ?? \STDIN);
            if (false === $line) {
                $io->error('No password on STDIN.');

                return null;
            }
            $password = rtrim($line, "\r\n");
        }
        if (null !== $password) {
            $message = $this->violation($validator, 'password', $password);
            if (null !== $message) {
                $io->error('Invalid password: '.$message);

                return null;
            }

            return $password;
        }
        if (!$input->isInteractive()) {
            $io->error('The password is missing: use --password, --password-stdin or run interactively.');

            return null;
        }
        while (true) {
            $first = (string) $io->askHidden('Password');
            $message = $this->violation($validator, 'password', $first);
            if (null !== $message) {
                $io->error($message);
                continue;
            }
            if ($first !== (string) $io->askHidden('Repeat password')) {
                $io->error('The passwords do not match.');
                continue;
            }

            return $first;
        }
    }

    /**
     * With OPAQUE on, a CLI password is a bcrypt (legacy) one: warn, and refuse after the cutoff unless forced.
     * Returns false when refused.
     */
    private function acceptLegacyPassword(SymfonyStyle $io, OpaqueRollout $rollout, ClockInterface $clock, bool $forceLegacy): bool
    {
        if (!$rollout->isEnabled()) {
            return true;
        }
        if ($rollout->cutoffReached($clock->now()) && !$forceLegacy) {
            $io->error('OPAQUE_LEGACY_CUTOFF is reached: a password here would create a legacy (bcrypt) account that cannot sign in. Use --link, or --force-legacy.');

            return false;
        }
        $io->warning('OPAQUE is enabled: this creates a legacy (bcrypt) password. It is upgraded on first sign-in; after the cutoff the user must reset it. Prefer --link.');

        return true;
    }
}
