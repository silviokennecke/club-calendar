<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Security\NonceStore;
use App\Security\SignedTokenService;
use Symfony\Component\Uid\Uuid;

/**
 * Signed, single-use `registrationState` of an OPAQUE signup: binds the user id (the credential identifier the
 * registration response was evaluated under, minted here, never taken from the client) to the address. The
 * finish creates the user with exactly this id and address.
 */
final readonly class OpaqueSignupStates
{
    public const int TTL = 900;
    private const string TOKEN_PURPOSE = 'opaque-signup';

    public function __construct(
        private SignedTokenService $tokens,
        private NonceStore $nonces,
    ) {
    }

    /** @return array{userId: string, state: string} */
    public function issue(string $email, string $keyId): array
    {
        $userId = Uuid::v7()->toRfc4122();

        return ['userId' => $userId, 'state' => $this->tokens->issue(self::TOKEN_PURPOSE, [
            'uid' => $userId,
            'email' => $email,
            'kid' => $keyId,
            'jti' => bin2hex(random_bytes(16)),
        ], self::TTL)];
    }

    /** @return array{userId: string, email: string, keyId: string, jti: string, exp: int}|null null for forged, expired or malformed states */
    public function open(string $state): ?array
    {
        $claims = $this->tokens->verify(self::TOKEN_PURPOSE, $state);
        if (null === $claims
            || !is_string($claims['uid'] ?? null)
            || !is_string($claims['email'] ?? null)
            || !is_string($claims['kid'] ?? null)
            || !is_string($claims['jti'] ?? null)
            || !is_int($claims['exp'] ?? null)
        ) {
            return null;
        }

        return ['userId' => $claims['uid'], 'email' => $claims['email'], 'keyId' => $claims['kid'], 'jti' => $claims['jti'], 'exp' => $claims['exp']];
    }

    /** True once per state. */
    public function consume(string $jti, int $exp): bool
    {
        return $this->nonces->consume(self::TOKEN_PURPOSE, $jti, $exp);
    }
}
