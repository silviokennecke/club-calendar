<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Entity\User;
use App\Security\NonceStore;
use App\Security\SignedTokenService;

/**
 * Proof of a fresh OPAQUE login for one sensitive action (plan 3.4): signed, 5 minutes, single use, bound to user,
 * session version (`tv`) and purpose. Issued by {@see OpaqueService::finishReauth()}, redeemed by the action.
 */
final readonly class OpaqueReauthTickets
{
    public const int TTL = 300;
    public const string PURPOSE_DELETE_ACCOUNT = 'delete-account';
    public const string PURPOSE_PASSKEY_REGISTER = 'passkey-register';
    public const string PURPOSE_CHANGE_EMAIL = 'change-email';
    public const string PURPOSE_CHANGE_PASSWORD = 'change-password';
    public const array PURPOSES = [
        self::PURPOSE_DELETE_ACCOUNT,
        self::PURPOSE_PASSKEY_REGISTER,
        self::PURPOSE_CHANGE_EMAIL,
        self::PURPOSE_CHANGE_PASSWORD,
    ];
    private const string TOKEN_PURPOSE = 'opaque-reauth';

    public function __construct(
        private SignedTokenService $tokens,
        private NonceStore $nonces,
    ) {
    }

    public function issue(User $user, string $purpose): string
    {
        if (!in_array($purpose, self::PURPOSES, true)) {
            throw new OpaqueException('Unknown reauth purpose.');
        }

        return $this->tokens->issue(self::TOKEN_PURPOSE, [
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'purpose' => $purpose,
            'jti' => bin2hex(random_bytes(16)),
        ], self::TTL);
    }

    /** Non-consuming check (register/start): the same conditions as {@see consume()} minus the replay guard. */
    public function isValid(User $user, string $purpose, string $ticket): bool
    {
        return null !== $this->claims($user, $purpose, $ticket);
    }

    /** True once per valid ticket; every failure (forged, expired, other user/purpose, ended session, replay) is false. */
    public function consume(User $user, string $purpose, string $ticket): bool
    {
        $claims = $this->claims($user, $purpose, $ticket);

        return null !== $claims && $this->nonces->consume(self::TOKEN_PURPOSE, $claims['jti'], $claims['exp']);
    }

    /** @return array{jti: string, exp: int}|null */
    private function claims(User $user, string $purpose, string $ticket): ?array
    {
        $claims = $this->tokens->verify(self::TOKEN_PURPOSE, $ticket);
        if (null === $claims
            || ($claims['uid'] ?? null) !== $user->getId()
            || ($claims['tv'] ?? null) !== $user->getTokenVersion()
            || ($claims['purpose'] ?? null) !== $purpose
            || !is_string($claims['jti'] ?? null)
            || !is_int($claims['exp'] ?? null)
        ) {
            return null;
        }

        return ['jti' => $claims['jti'], 'exp' => $claims['exp']];
    }
}
