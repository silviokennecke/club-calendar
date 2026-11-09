<?php

declare(strict_types=1);

namespace App\Opaque;

/** Answer to a login/reauth start: raw KE2 bytes, the sealed state blob (base64url) and the client's KSF profile. */
final readonly class OpaqueLoginChallenge
{
    public function __construct(
        public string $ke2,
        public string $loginState,
        public string $ksfProfile,
    ) {
    }
}
