<?php

declare(strict_types=1);

namespace App\Security\Mfa;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\NonceStore;

/**
 * The one exact per-user budget for failed MFA factor checks, shared by the MFA step of the sign-in and the
 * step-up confirmation: each failed check takes a free slot (unique insert in `NonceStore`) that frees up
 * WINDOW seconds later, so never more than MAX_FAILURES evaluated failures per window, whichever route or token
 * they came through. MUST be called inside a transaction holding the user row lock (`SELECT ... FOR UPDATE`),
 * which serialises concurrent attempts. A success deliberately does not reset it: otherwise whoever holds one
 * valid factor, or the legitimate user in between, would hand an attacker fresh guesses.
 */
readonly class MfaFailureBudget
{
    public const string PURPOSE = 'mfa.user_failure';
    public const int MAX_FAILURES = 5;
    public const int WINDOW = 900;

    public function __construct(private NonceStore $nonces)
    {
    }

    /** @throws ApiProblemException 429 `rate_limited` while all slots are live */
    public function assertNotLocked(User $user): void
    {
        $live = $this->nonces->liveExpiries(self::PURPOSE, $this->slots($user));
        if (count($live) >= self::MAX_FAILURES) {
            throw new ApiProblemException(429, 'Too many requests', 'rate_limited', null, ['Retry-After' => (string) max(1, min($live) - time())]);
        }
    }

    public function recordFailure(User $user): void
    {
        foreach ($this->slots($user) as $slot) {
            if ($this->nonces->consume(self::PURPOSE, $slot, time() + self::WINDOW - 60)) {
                return;
            }
        }
    }

    /** @return list<string> */
    private function slots(User $user): array
    {
        return array_map(static fn (int $i): string => $user->getId().'#'.$i, range(1, self::MAX_FAILURES));
    }
}
