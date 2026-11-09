<?php

declare(strict_types=1);

namespace App\Opaque;

final readonly class DerivedKeys
{
    public function __construct(
        #[\SensitiveParameter] public string $sessionKey,
        #[\SensitiveParameter] public string $handshakeSecret,
        #[\SensitiveParameter] public string $serverMacKey,
        #[\SensitiveParameter] public string $clientMacKey,
        public string $transcriptHash,
    ) {
    }

    /** @return array<string, never> */
    public function __debugInfo(): array
    {
        return [];
    }
}
