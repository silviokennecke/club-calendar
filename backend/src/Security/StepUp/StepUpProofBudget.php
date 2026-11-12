<?php

declare(strict_types=1);

namespace App\Security\StepUp;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\NonceStore;

/**
 * Exact per-user budget for failed step-up PROOFS (wrong password or wrong mailed code), the counterpart of
 * {@see \App\Security\Mfa\MfaFailureBudget} for the first step of the confirmation: each failure takes a free slot
 * (unique insert in `NonceStore`) that frees up WINDOW seconds later. MUST be called inside a transaction holding
 * the user row lock (`SELECT ... FOR UPDATE`), which serialises concurrent attempts, so never more than
 * MAX_FAILURES proofs are evaluated wrongly per window, however many requests run in parallel. A success does not
 * reset it.
 */
readonly class StepUpProofBudget
{
    public const string PURPOSE = 'step_up.proof_failure';
    public const int MAX_FAILURES = 10;
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
