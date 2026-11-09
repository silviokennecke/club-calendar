<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Entity\User;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;

/**
 * The `auth` field of POST /api/auth/identify: which credential protocol the client must use next.
 * `opaque` OPAQUE login/signup; `legacy` plaintext password endpoints (bcrypt, or flag off); `none` no password
 * credential (SSO/passkey only); `reset_required` the password cannot be used any more (cutoff passed, or only an
 * OPAQUE record exists while the flag is off): use "forgot password".
 */
final class OpaqueAuthHint
{
    public const string OPAQUE = 'opaque';
    public const string LEGACY = 'legacy';
    public const string NONE = 'none';
    public const string RESET_REQUIRED = 'reset_required';

    public function __construct(
        private readonly OpaqueRollout $rollout,
        private readonly OpaqueService $opaque,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
    ) {
    }

    /** New address: the signup protocol (plan 6.2: signup and reset are OPAQUE as soon as the flag is on). */
    public function forSignup(): string
    {
        return $this->rollout->isEnabled() ? self::OPAQUE : self::LEGACY;
    }

    public function forAccount(User $user): string
    {
        $enabled = $this->rollout->isEnabled();
        if ($this->opaque->hasRecord($user)) {
            if ($enabled) {
                return self::OPAQUE;
            }

            return null !== $user->getPassword() ? self::LEGACY : $this->resetRequired($user, 'flag_off');
        }
        if (null !== $user->getPassword()) {
            return $enabled && $this->rollout->cutoffReached($this->clock->now()) ? $this->resetRequired($user, 'cutoff') : self::LEGACY;
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
