<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\MfaBackupCode;
use App\Entity\Passkey;
use App\Entity\User;
use App\Entity\UserTotp;
use App\Enum\SecurityEventType;
use App\Exception\ApiProblemException;
use App\Repository\MfaBackupCodeRepository;
use App\Repository\UserTotpRepository;
use App\Security\ClientContext;
use App\Security\ClientContextResolver;
use App\Security\Mfa\BackupCodeGenerator;
use App\Security\Mfa\Totp;
use App\Security\NonceStore;
use App\Security\SignedTokenService;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\PasswordHasher\Hasher\PasswordHasherFactoryInterface;
use Symfony\Component\Uid\Uuid;

/**
 * MFA of the sign-in: TOTP, backup codes and the per-account enforcement switch (`mfa_enforced`).
 * Rate limits and re-authentication are the controller's job; this service owns the state changes. Ending MFA
 * (disable, backup-code sign-in) bumps the token version, which ends all other sessions and MCP grants;
 * enabling does not.
 */
class MfaService
{
    public const string ISSUER = 'Club Calendar';
    public const string PURPOSE_SETUP = 'mfa.setup';
    public const int SETUP_TTL = 900;
    public const string METHOD_TOTP = 'totp';
    public const string METHOD_PASSKEYS = 'passkeys';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserTotpRepository $totps,
        private readonly MfaBackupCodeRepository $backupCodes,
        private readonly BackupCodeGenerator $generator,
        private readonly PasswordHasherFactoryInterface $hasherFactory,
        private readonly SignedTokenService $signedTokens,
        private readonly NonceStore $nonces,
        private readonly TokenService $tokens,
        private readonly SecurityEventLogger $events,
        private readonly AccountMailer $mailer,
        private readonly ClientContextResolver $contextResolver,
    ) {
    }

    /** @return array{enforced: bool, totp: array{createdAt: string}|null, backupCodes: array{remaining: int, createdAt: string}|null, canEnforce: bool} */
    public function status(User $user): array
    {
        $totp = $this->totps->findOneByUser($user);
        $total = $this->backupCodes->countAll($user);
        $createdAt = $total > 0 ? $this->backupCodes->latestCreatedAt($user) : null;

        return [
            'enforced' => $user->isMfaEnforced(),
            'totp' => null === $totp ? null : ['createdAt' => $totp->getCreatedAt()->format(\DATE_ATOM)],
            'backupCodes' => $total > 0 && null !== $createdAt
                ? ['remaining' => $this->backupCodes->countUnused($user), 'createdAt' => $createdAt->format(\DATE_ATOM)]
                : null,
            'canEnforce' => !$user->isMfaEnforced() && $this->passkeyCount($user) >= 1,
        ];
    }

    /**
     * Nothing is stored. The signed token binds the generated secret and codes (hash), so the client cannot
     * choose its own. Backup codes are returned only when no set is active (enforcement already on keeps them).
     *
     * @return array{setupToken: string, backupCodes: list<string>|null, secret?: string, otpauthUri?: string}
     */
    public function setup(User $user, string $method): array
    {
        if (self::METHOD_TOTP === $method) {
            if (null !== $this->totps->findOneByUser($user)) {
                throw new ApiProblemException(409, 'An authenticator app is already set up', 'totp_already_set');
            }
        } elseif (self::METHOD_PASSKEYS === $method) {
            if ($user->isMfaEnforced()) {
                throw new ApiProblemException(409, 'MFA is already on', 'mfa_already_enabled');
            }
            if ($this->passkeyCount($user) < 1) {
                throw new ApiProblemException(422, 'Add a passkey first', 'mfa_passkey_required');
            }
        } else {
            throw new ApiProblemException(400, 'Unknown method', 'invalid_request', 'method');
        }

        $secret = self::METHOD_TOTP === $method ? Totp::generateSecret() : '';
        $codes = $user->isMfaEnforced() ? null : $this->generator->generate();
        $token = $this->signedTokens->issue(self::PURPOSE_SETUP, [
            'sub' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'm' => $method,
            'h' => $this->setupHash($secret, $codes),
            'jti' => Uuid::v7()->toRfc4122(),
        ], self::SETUP_TTL);

        $result = ['setupToken' => $token, 'backupCodes' => $codes];
        if (self::METHOD_TOTP === $method) {
            $result['secret'] = $secret;
            $result['otpauthUri'] = Totp::otpauthUri(self::ISSUER, $user->getEmail(), $secret);
        }

        return $result;
    }

    /**
     * Turns MFA on. Does NOT end other sessions.
     *
     * Records the `mfa_enabled` event and sends the notice (context defaults to the current request).
     *
     * @param list<string>|null $backupCodes the codes exactly as issued by setup(), null when setup returned none
     *
     * @return array the new status
     *
     * @throws ApiProblemException 400 `invalid_mfa_setup`, 422 `backup_codes_not_acknowledged`, 422 `invalid_totp_code`,
     *                             409 `mfa_already_enabled` / `totp_already_set`, 422 `mfa_passkey_required`
     */
    public function enable(User $user, string $setupToken, string $method, ?string $secret, ?string $totpCode, ?array $backupCodes, bool $acknowledged, ?ClientContext $context = null): array
    {
        $claims = $this->signedTokens->verify(self::PURPOSE_SETUP, $setupToken);
        $secret = self::METHOD_TOTP === $method ? (string) $secret : '';
        if (null === $claims
            || ($claims['sub'] ?? null) !== $user->getId()
            || ($claims['tv'] ?? null) !== $user->getTokenVersion()
            || ($claims['m'] ?? null) !== $method
            || (null !== $backupCodes && array_filter($backupCodes, is_string(...)) !== $backupCodes)
            || !is_string($claims['jti'] ?? null)
            || !is_string($claims['h'] ?? null)
            || !hash_equals($claims['h'], $this->setupHash($secret, $backupCodes))
        ) {
            throw new ApiProblemException(400, 'The setup is invalid or expired', 'invalid_mfa_setup');
        }
        if (null !== $backupCodes && !$acknowledged) {
            throw new ApiProblemException(422, 'Confirm that you stored the backup codes', 'backup_codes_not_acknowledged');
        }
        $step = null;
        if (self::METHOD_TOTP === $method) {
            $step = Totp::verify($secret, (string) $totpCode);
            if (null === $step) {
                throw new ApiProblemException(422, 'The code is not correct', 'invalid_totp_code', 'code');
            }
        }

        $this->em->wrapInTransaction(function () use ($user, $claims, $method, $secret, $step, $backupCodes): void {
            $this->em->refresh($user, LockMode::PESSIMISTIC_WRITE);
            if (self::METHOD_TOTP === $method) {
                if (null !== $this->totps->findOneByUser($user)) {
                    throw new ApiProblemException(409, 'An authenticator app is already set up', 'totp_already_set');
                }
            } elseif ($user->isMfaEnforced()) {
                throw new ApiProblemException(409, 'MFA is already on', 'mfa_already_enabled');
            } elseif ($this->passkeyCount($user) < 1) {
                throw new ApiProblemException(422, 'Add a passkey first', 'mfa_passkey_required');
            }
            if (!$this->nonces->consume(self::PURPOSE_SETUP, $claims['jti'], (int) $claims['exp'])) {
                throw new ApiProblemException(400, 'The setup is invalid or expired', 'invalid_mfa_setup');
            }
            if (self::METHOD_TOTP === $method) {
                // The first accepted step is spent: the same code cannot be replayed at sign-in
                $this->em->persist(new UserTotp($user, $secret)->setLastUsedStep($step));
            }
            if (null !== $backupCodes) {
                $this->storeCodes($user, $backupCodes);
            }
            if (!$user->isMfaEnforced()) {
                $user->setMfaEnforced(true);
            }
            $this->em->flush();
        });

        $this->notify($user, SecurityEventType::MFA_ENABLED, $method, $context);

        return $this->status($user);
    }

    /**
     * Replaces the backup codes; returns the new codes (shown once).
     *
     * @return list<string>
     */
    public function regenerateBackupCodes(User $user, ?ClientContext $context = null): array
    {
        $this->assertEnabled($user);
        $codes = $this->generator->generate();
        $this->em->wrapInTransaction(function () use ($user, $codes): void {
            $this->em->refresh($user, LockMode::PESSIMISTIC_WRITE);
            $this->assertEnabled($user);
            $this->backupCodes->deleteAll($user);
            $this->storeCodes($user, $codes);
            $this->em->flush();
        });
        $this->notify($user, SecurityEventType::BACKUP_CODES_REGENERATED, null, $context);

        return $codes;
    }

    /**
     * Turns MFA off (profile and CLI; the caller re-authenticates). Removes TOTP and codes, keeps
     * passkeys, ends all sessions and MCP grants. The caller issues a fresh token pair if a session continues.
     *
     * `$method` is the event method; default `password`, or `cli` when no client address is known.
     *
     * @throws ApiProblemException 409 `mfa_not_enabled`
     */
    public function disable(User $user, ?ClientContext $context = null, ?string $method = null): void
    {
        $this->assertEnabled($user);
        $this->removeAndEndSessions($user);
        $this->notify($user, SecurityEventType::MFA_DISABLED, $method, $context);
    }

    /** Backup-code sign-in: same effect as disable(); the caller then issues the token pair of the new session. */
    public function endEnforcement(User $user, ?ClientContext $context = null): void
    {
        $this->endEnforcementState($user);
        $this->notifyBackupCodeUsed($user, $context);
    }

    /** The state change of endEnforcement() only, so a caller can run it inside its own transaction. */
    public function endEnforcementState(User $user): void
    {
        $this->removeAndEndSessions($user);
    }

    public function notifyBackupCodeUsed(User $user, ?ClientContext $context = null): void
    {
        $this->notify($user, SecurityEventType::BACKUP_CODE_USED, 'backup_code', $context);
    }

    /** Checks a TOTP code at sign-in; a step is accepted once (race safe). */
    public function verifyTotp(User $user, string $code): bool
    {
        $totp = $this->totps->findOneByUser($user);
        if (null === $totp) {
            return false;
        }
        $this->em->refresh($totp);
        $step = Totp::verify($totp->getSecret(), $code, $totp->getLastUsedStep());
        if (null === $step) {
            return false;
        }

        return $this->totps->advanceStep($totp, $step);
    }

    /** Consumes a backup code (single use, race safe); malformed input is just false. */
    public function consumeBackupCode(User $user, string $code): bool
    {
        if (!$this->generator->isWellFormed($code)) {
            return false;
        }

        // Verify against every unused row (no early exit) so timing does not reveal which code matched.
        $hasher = $this->hasherFactory->getPasswordHasher('backup_code');
        $normalized = $this->generator->normalize($code);
        $match = null;
        foreach ($this->backupCodes->findUnused($user) as $row) {
            if ($hasher->verify($row->getCodeHash(), $normalized) && null === $match) {
                $match = $row;
            }
        }

        return null !== $match && $this->backupCodes->consume($match->getId());
    }

    /** @throws ApiProblemException 422 `mfa_last_passkey` when the passkey is the only factor left */
    public function assertPasskeyDeletable(User $user): void
    {
        if ($user->isMfaEnforced() && null === $this->totps->findOneByUser($user) && $this->passkeyCount($user) <= 1) {
            throw new ApiProblemException(422, 'The last passkey cannot be deleted while MFA is on', 'mfa_last_passkey');
        }
    }

    private function removeAndEndSessions(User $user): void
    {
        $this->em->wrapInTransaction(function () use ($user): void {
            $this->em->refresh($user, LockMode::PESSIMISTIC_WRITE);
            $totp = $this->totps->findOneByUser($user);
            if (null !== $totp) {
                $this->em->remove($totp);
            }
            $this->backupCodes->deleteAll($user);
            $user->setMfaEnforced(false);
            $user->invalidateTokens();
            $this->em->flush();
        });
        $this->tokens->revokeAllRefreshTokens($user);
    }

    private function notify(User $user, SecurityEventType $type, ?string $method, ?ClientContext $context): void
    {
        $context ??= $this->contextResolver->current();
        if (SecurityEventType::MFA_DISABLED === $type) {
            $method ??= null === $context->ip ? 'cli' : 'password';
        }
        $this->events->record($user, $type, true, $method, null, $context);
        match ($type) {
            SecurityEventType::MFA_ENABLED => $this->mailer->sendMfaEnabled($user, $context),
            SecurityEventType::MFA_DISABLED => $this->mailer->sendMfaDisabled($user, $context, 'cli' === $method),
            SecurityEventType::BACKUP_CODE_USED => $this->mailer->sendBackupCodeUsed($user, $context),
            default => $this->mailer->sendBackupCodesRegenerated($user, $context),
        };
    }

    private function assertEnabled(User $user): void
    {
        if (!$user->isMfaEnforced()) {
            throw new ApiProblemException(409, 'MFA is not on', 'mfa_not_enabled');
        }
    }

    /** @param list<string> $codes */
    private function storeCodes(User $user, array $codes): void
    {
        $hasher = $this->hasherFactory->getPasswordHasher('backup_code');
        foreach ($codes as $code) {
            $this->em->persist(new MfaBackupCode($user, $hasher->hash($this->generator->normalize($code))));
        }
    }

    /** @param list<string>|null $codes */
    private function setupHash(string $secret, ?array $codes): string
    {
        $normalized = null === $codes ? '-' : implode(',', array_map($this->generator->normalize(...), $codes));

        return hash('sha256', $secret."\0".$normalized);
    }

    private function passkeyCount(User $user): int
    {
        return $this->em->getRepository(Passkey::class)->count(['user' => $user]);
    }
}
