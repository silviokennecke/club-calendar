<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use App\Enum\SecurityEventType;
use App\Exception\ApiProblemException;
use App\Security\Mfa\MfaFailureBudget;
use App\Security\StepUp\StepUpTokenService;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Step-up confirmation of sensitive actions. Proof = the password (or, for accounts without one, the mailed
 * code, {@see ReauthenticationService}) plus, when MFA is on, one factor (authenticator code, backup code or
 * passkey assertion). The factor check runs like the MFA sign-in: inside a transaction holding the user row
 * lock, against the same exact per-user failure budget ({@see MfaFailureBudget}), a spent backup code or TOTP step
 * stays spent. The result is a {@see StepUpTokenService} token; no session is touched.
 */
class StepUpService
{
    public const string METHOD_PASSKEY = 'passkey';
    public const string PURPOSE_CODE = ReauthenticationService::PURPOSE_STEP_UP;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ReauthenticationService $reauth,
        private readonly MfaService $mfa,
        private readonly WebAuthnService $webAuthn,
        private readonly MfaFailureBudget $budget,
        private readonly StepUpTokenService $tokens,
        private readonly SecurityEventLogger $events,
    ) {
    }

    /** @return array{password: bool, mfa: list<string>} what the client can offer for the confirmation form */
    public function methods(User $user): array
    {
        $mfa = [];
        if ($user->isMfaEnforced()) {
            if (null !== $this->mfa->status($user)['totp']) {
                $mfa[] = MfaLoginService::METHOD_TOTP;
            }
            $mfa[] = MfaLoginService::METHOD_BACKUP;
            if (!$user->getPasskeys()->isEmpty()) {
                $mfa[] = self::METHOD_PASSKEY;
            }
        }

        return ['password' => null !== $user->getPassword(), 'mfa' => $mfa];
    }

    public function sendCode(User $user): void
    {
        $this->tokens->requireFamily();
        $this->reauth->sendCode($user, self::PURPOSE_CODE);
    }

    /** @return array{options: array<string, mixed>, challengeToken: string} */
    public function passkeyOptions(User $user): array
    {
        $this->tokens->requireFamily();
        if ($user->getPasskeys()->isEmpty()) {
            throw new ApiProblemException(400, 'No passkey is registered', 'invalid_request');
        }

        return $this->webAuthn->getMfaOptions($user, WebAuthnService::PURPOSE_STEP_UP);
    }

    /**
     * @param array{method: string, code?: string, challengeToken?: string, response?: array<mixed>}|null $factor
     *
     * @return array{stepUpToken: string, expiresIn: int, backupCodeUsed?: true, backupCodesRemaining?: int}
     *
     * @throws ApiProblemException 403 `step_up_unavailable`, 400 `invalid_credentials` (field `password`),
     *                             400 `invalid_confirmation_code` (field `code`), 422 `mfa_factor_required`,
     *                             422 `invalid_mfa_code` (field `code`), 422 `invalid_passkey`, 429 `rate_limited`
     */
    public function confirm(User $user, ?string $password, ?string $confirmationCode, ?array $factor): array
    {
        $this->tokens->requireFamily();
        $proof = null !== $user->getPassword() ? 'password' : 'code';
        try {
            $this->reauth->assertConfirmed($user, self::PURPOSE_CODE, $password, $confirmationCode);
        } catch (ApiProblemException $e) {
            $this->events->record($user, SecurityEventType::STEP_UP, false, $proof);

            throw $e;
        }
        if (!$user->isMfaEnforced()) {
            return $this->succeeded($user, $proof, []);
        }
        if (null === $factor) {
            throw new ApiProblemException(422, 'An MFA factor is required', 'mfa_factor_required', 'factor');
        }

        return $this->confirmFactor($user, $proof, $factor);
    }

    /** @param array<string, mixed> $factor */
    private function confirmFactor(User $user, string $proof, array $factor): array
    {
        $method = (string) $factor['method'];
        $failure = null;
        $extra = [];
        $this->em->wrapInTransaction(function () use ($user, $method, $factor, &$failure, &$extra): void {
            $tokenVersion = $user->getTokenVersion();
            if (false === $this->em->getConnection()->fetchOne('SELECT id FROM user WHERE id = ? FOR UPDATE', [$user->getId()])) {
                throw new ApiProblemException(401, 'User not found', 'invalid_token', null, ['WWW-Authenticate' => 'Bearer']);
            }
            $this->em->refresh($user);
            if ($user->getTokenVersion() !== $tokenVersion) {
                throw new ApiProblemException(401, 'The session has ended', 'invalid_token', null, ['WWW-Authenticate' => 'Bearer']);
            }
            if (!$user->isMfaEnforced()) {
                return;
            }
            $this->budget->assertNotLocked($user);
            try {
                $ok = match ($method) {
                    MfaLoginService::METHOD_TOTP => $this->mfa->verifyTotp($user, $factor['code']),
                    MfaLoginService::METHOD_BACKUP => $this->mfa->consumeBackupCode($user, $factor['code']),
                    default => $this->passkeyAssertion($user, $factor),
                };
                $failure = $ok ? null : new ApiProblemException(422, 'The code is not correct', 'invalid_mfa_code', 'code');
            } catch (ApiProblemException $e) {
                $failure = $e;
            }
            if (null !== $failure) {
                $this->budget->recordFailure($user);

                return;
            }
            if (MfaLoginService::METHOD_BACKUP === $method) {
                $extra = ['backupCodeUsed' => true, 'backupCodesRemaining' => $this->mfa->remainingBackupCodes($user)];
            }
        });
        if (null !== $failure) {
            $this->events->record($user, SecurityEventType::STEP_UP, false, $method);

            throw $failure;
        }
        if (MfaLoginService::METHOD_BACKUP === $method) {
            $this->mfa->notifyBackupCodeUsed($user, $extra['backupCodesRemaining']);
        }

        return $this->succeeded($user, $user->isMfaEnforced() ? $method : $proof, $extra);
    }

    /** @param array<string, mixed> $factor */
    private function passkeyAssertion(User $user, array $factor): bool
    {
        try {
            $this->webAuthn->verifyMfaAssertion($user, $factor['challengeToken'], $factor['response'], WebAuthnService::PURPOSE_STEP_UP);
        } catch (ApiProblemException) {
            throw new ApiProblemException(422, 'The passkey could not be verified', 'invalid_passkey');
        }

        return true;
    }

    /** @param array<string, mixed> $extra */
    private function succeeded(User $user, string $method, array $extra): array
    {
        $issued = $this->tokens->issue($user);
        $this->events->record($user, SecurityEventType::STEP_UP, true, $method);

        return ['stepUpToken' => $issued['token'], 'expiresIn' => $issued['expiresIn']] + $extra;
    }
}
