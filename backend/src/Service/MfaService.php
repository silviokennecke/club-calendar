<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\MfaBackupCode;
use App\Entity\Passkey;
use App\Entity\User;
use App\Entity\UserTotp;
use App\Exception\ApiProblemException;
use App\Repository\MfaBackupCodeRepository;
use App\Repository\UserTotpRepository;
use App\Security\ClientContext;
use App\Security\Mfa\BackupCodeGenerator;
use App\Security\Mfa\Totp;
use App\Security\NonceStore;
use App\Security\SignedTokenService;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Uid\Uuid;

/**
 * Second factor of the sign-in: TOTP, backup codes and the per-account enforcement switch (`mfa_enforced`).
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
        private readonly SignedTokenService $signedTokens,
        private readonly NonceStore $nonces,
        private readonly TokenService $tokens,
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
                throw new ApiProblemException(409, 'Two-step sign-in is already on', 'mfa_already_enabled');
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
     * Turns two-step sign-in on. Does NOT end other sessions.
     *
     * `$context` is reserved for the security event and mail of the caller wiring.
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
                throw new ApiProblemException(409, 'Two-step sign-in is already on', 'mfa_already_enabled');
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

        return $codes;
    }

    /**
     * Turns two-step sign-in off (profile and CLI; the caller re-authenticates). Removes TOTP and codes, keeps
     * passkeys, ends all sessions and MCP grants. The caller issues a fresh token pair if a session continues.
     *
     * @throws ApiProblemException 409 `mfa_not_enabled`
     */
    public function disable(User $user, ?ClientContext $context = null): void
    {
        $this->assertEnabled($user);
        $this->removeAndEndSessions($user);
    }

    /** Backup-code sign-in: same effect as disable(); the caller then issues the token pair of the new session. */
    public function endEnforcement(User $user, ?ClientContext $context = null): void
    {
        $this->removeAndEndSessions($user);
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

        return $this->backupCodes->consume($user, $this->generator->hash($code));
    }

    /** @throws ApiProblemException 422 `mfa_last_passkey` when the passkey is the only second factor left */
    public function assertPasskeyDeletable(User $user): void
    {
        if ($user->isMfaEnforced() && null === $this->totps->findOneByUser($user) && $this->passkeyCount($user) <= 1) {
            throw new ApiProblemException(422, 'The last passkey cannot be deleted while two-step sign-in is on', 'mfa_last_passkey');
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

    private function assertEnabled(User $user): void
    {
        if (!$user->isMfaEnforced()) {
            throw new ApiProblemException(409, 'Two-step sign-in is not on', 'mfa_not_enabled');
        }
    }

    /** @param list<string> $codes */
    private function storeCodes(User $user, array $codes): void
    {
        foreach ($codes as $code) {
            $this->em->persist(new MfaBackupCode($user, $this->generator->hash($code)));
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
