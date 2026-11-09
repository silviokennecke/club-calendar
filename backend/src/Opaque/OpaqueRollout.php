<?php

declare(strict_types=1);

namespace App\Opaque;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Rollout configuration of OPAQUE (docs/ops/OPAQUE-PLAN.md 6.2): the flag, the share of legacy accounts that is offered
 * the upgrade (stable per-account bucket, only grows with the percentage) and the phase 2 cutoff date.
 */
final class OpaqueRollout
{
    private readonly int $percent;
    private readonly ?\DateTimeImmutable $cutoff;

    public function __construct(
        #[Autowire(env: 'bool:OPAQUE_ENABLED')]
        private readonly bool $enabled,
        #[Autowire(env: 'OPAQUE_ROLLOUT_PERCENT')]
        string $percent,
        #[Autowire(env: 'OPAQUE_LEGACY_CUTOFF')]
        string $cutoff,
        #[Autowire(env: 'APP_SECRET')]
        #[\SensitiveParameter]
        private readonly string $appSecret,
    ) {
        self::validate($percent, $cutoff);
        $this->percent = (int) $percent;
        $this->cutoff = '' === $cutoff ? null : new \DateTimeImmutable($cutoff.' 00:00:00', new \DateTimeZone('UTC'));
    }

    /** @throws OpaqueException on a percentage outside 0-100 or a cutoff that is not an existing YYYY-MM-DD date */
    public static function validate(string $percent, string $cutoff): void
    {
        if (1 !== preg_match('/^(100|[1-9]?\d)$/', $percent)) {
            throw new OpaqueException('OPAQUE_ROLLOUT_PERCENT must be an integer from 0 to 100.');
        }
        if ('' === $cutoff) {
            return;
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $cutoff, new \DateTimeZone('UTC'));
        if (false === $date || $date->format('Y-m-d') !== $cutoff) {
            throw new OpaqueException('OPAQUE_LEGACY_CUTOFF must be empty or a valid date (YYYY-MM-DD).');
        }
    }

    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    public function percent(): int
    {
        return $this->percent;
    }

    public function cutoff(): ?\DateTimeImmutable
    {
        return $this->cutoff;
    }

    /** Stable bucket 0-99 of an account (keyed hash of the user id, independent of the percentage). */
    public function bucket(string $userId): int
    {
        $key = hash_hmac('sha256', 'opaque-rollout', $this->appSecret, true);

        return unpack('N', hash_hmac('sha256', $userId, $key, true))[1] % 100;
    }

    /** Whether a legacy account is offered the upgrade (flag on and bucket inside the percentage; everyone once a cutoff is set). */
    public function offersUpgrade(string $userId): bool
    {
        return $this->enabled && (null !== $this->cutoff || $this->bucket($userId) < $this->percent);
    }

    /** A cutoff with less than 100 % would remind accounts that never get an upgrade offer. */
    public static function cutoffNeedsFullRollout(string $percent, string $cutoff): bool
    {
        return '' !== $cutoff && (int) $percent < 100;
    }

    public function cutoffReached(\DateTimeInterface $now): bool
    {
        return null !== $this->cutoff && $now >= $this->cutoff;
    }
}
