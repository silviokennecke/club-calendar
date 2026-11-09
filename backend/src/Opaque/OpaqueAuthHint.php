<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Entity\User;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;

/**
 * The `auth` field of POST /api/auth/identify: which credential protocol the client must use next.
 * `opaque` OPAQUE login/signup; `legacy` plaintext login of a not yet migrated bcrypt account (before the cutoff);
 * `none` no password credential (SSO/passkey only); `reset_required` the password cannot be used any more (cutoff
 * passed, or an unusable record): use "forgot password".
 */
final class OpaqueAuthHint
{
    public const string OPAQUE = 'opaque';
    public const string LEGACY = 'legacy';
    public const string NONE = 'none';
    public const string RESET_REQUIRED = 'reset_required';

    public function __construct(
        private readonly OpaqueCutoff $cutoff,
        private readonly OpaqueService $opaque,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
    ) {
    }

    /** New address: signup is always OPAQUE. */
    public function forSignup(): string
    {
        return self::OPAQUE;
    }

    public function forAccount(User $user): string
    {
        if ($this->opaque->hasRecord($user)) {
            return self::OPAQUE;
        }
        if (null !== $user->getPassword()) {
            return $this->cutoff->cutoffReached($this->clock->now()) ? $this->resetRequired($user, 'cutoff') : self::LEGACY;
        }

        // Unusable (corrupt) record without a hash: reset is the only way back.
        return null !== $user->getOpaqueRecord() ? $this->resetRequired($user, 'corrupt_record') : self::NONE;
    }

    private function resetRequired(User $user, string $reason): string
    {
        $this->logger->info('opaque.identify.reset_required', ['userId' => $user->getId(), 'reason' => $reason]);

        return self::RESET_REQUIRED;
    }
}
