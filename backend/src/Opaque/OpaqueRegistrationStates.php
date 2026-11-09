<?php

declare(strict_types=1);

namespace App\Opaque;

use App\Security\SignedTokenService;

/**
 * Signed `registrationState` of the non-signup registration contexts (reset, change, upgrade): binds the key id the
 * registration response was evaluated under to the user and the context, so `register/finish` stores the record under
 * that key even if the active key changed in between. Single use is not needed: the finish is guarded by the link/ticket.
 */
final readonly class OpaqueRegistrationStates
{
    public const int TTL = 900;
    private const string TOKEN_PURPOSE = 'opaque-register';

    public function __construct(private SignedTokenService $tokens)
    {
    }

    public function issue(string $userId, string $context, string $keyId): string
    {
        return $this->tokens->issue(self::TOKEN_PURPOSE, ['uid' => $userId, 'ctx' => $context, 'kid' => $keyId], self::TTL);
    }

    /** @return string|null the key id; null for forged, expired or malformed states and for another user or context */
    public function keyId(string $state, string $context, string $userId): ?string
    {
        $claims = $this->tokens->verify(self::TOKEN_PURPOSE, $state);
        if (null === $claims
            || ($claims['uid'] ?? null) !== $userId
            || ($claims['ctx'] ?? null) !== $context
            || !is_string($claims['kid'] ?? null)
        ) {
            return null;
        }

        return $claims['kid'];
    }
}
