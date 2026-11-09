<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Entity\User;
use App\Security\NonceStore;
use App\Security\SignedTokenService;

/**
 * Permission to register an OPAQUE record for a user who just proved the legacy password (plan 6.4): signed,
 * 5 minutes, single use, bound to user and session version. Issued after a successful legacy login (AP 14), so a
 * stolen access token alone cannot replace the password. The bcrypt hash stays until phase 2.
 */
final readonly class OpaqueUpgradeTickets
{
    public const int TTL = 300;
    private const string TOKEN_PURPOSE = 'opaque-upgrade';

    public function __construct(
        private SignedTokenService $tokens,
        private NonceStore $nonces,
    ) {
    }

    public function issue(User $user): string
    {
        return $this->tokens->issue(self::TOKEN_PURPOSE, [
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'jti' => bin2hex(random_bytes(16)),
        ], self::TTL);
    }

    /** Non-consuming check (register/start). */
    public function isValid(User $user, string $ticket): bool
    {
        return null !== $this->claims($user, $ticket);
    }

    /** True once per valid ticket. */
    public function consume(User $user, string $ticket): bool
    {
        $claims = $this->claims($user, $ticket);

        return null !== $claims && $this->nonces->consume(self::TOKEN_PURPOSE, $claims['jti'], $claims['exp']);
    }

    /** @return array{jti: string, exp: int}|null */
    private function claims(User $user, string $ticket): ?array
    {
        $claims = $this->tokens->verify(self::TOKEN_PURPOSE, $ticket);
        if (null === $claims
            || ($claims['uid'] ?? null) !== $user->getId()
            || ($claims['tv'] ?? null) !== $user->getTokenVersion()
            || !is_string($claims['jti'] ?? null)
            || !is_int($claims['exp'] ?? null)
        ) {
            return null;
        }

        return ['jti' => $claims['jti'], 'exp' => $claims['exp']];
    }
}
