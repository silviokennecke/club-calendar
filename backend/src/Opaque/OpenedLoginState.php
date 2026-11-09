<?php

declare(strict_types=1);

namespace App\Opaque;

final readonly class OpenedLoginState
{
    public function __construct(
        public ServerLoginState $state,
        public string $jti,
        public int $expiresAt,
        public string $purpose,
        public bool $fake,
        /** RFC 4122 user id; meaningless random bytes when fake */
        public string $userId,
        public int $tokenVersion,
        public string $recordHash,
    ) {
    }
}
