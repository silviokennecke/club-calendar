<?php

declare(strict_types=1);

namespace App\Opaque;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Phase 2 date of the OPAQUE migration (OPAQUE_LEGACY_CUTOFF, empty or YYYY-MM-DD in UTC). Until then (or without a
 * date) every legacy account is offered the upgrade at its next login; from then on bcrypt hashes stop working.
 */
final class OpaqueCutoff
{
    private readonly ?\DateTimeImmutable $cutoff;

    public function __construct(
        #[Autowire(env: 'OPAQUE_LEGACY_CUTOFF')]
        string $cutoff,
    ) {
        self::validate($cutoff);
        $this->cutoff = '' === $cutoff ? null : new \DateTimeImmutable($cutoff.' 00:00:00', new \DateTimeZone('UTC'));
    }

    /** @throws OpaqueException unless empty or an existing YYYY-MM-DD date */
    public static function validate(string $cutoff): void
    {
        if ('' === $cutoff) {
            return;
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $cutoff, new \DateTimeZone('UTC'));
        if (false === $date || $date->format('Y-m-d') !== $cutoff) {
            throw new OpaqueException('OPAQUE_LEGACY_CUTOFF must be empty or a valid date (YYYY-MM-DD).');
        }
    }

    public function cutoff(): ?\DateTimeImmutable
    {
        return $this->cutoff;
    }

    public function cutoffReached(\DateTimeInterface $now): bool
    {
        return null !== $this->cutoff && $now >= $this->cutoff;
    }
}
