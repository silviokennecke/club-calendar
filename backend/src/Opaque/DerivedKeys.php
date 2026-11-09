<?php

declare(strict_types=1);

namespace App\Opaque;

final readonly class DerivedKeys
{
    public function __construct(
        #[\SensitiveParameter] private string $sessionKey,
        #[\SensitiveParameter] private string $handshakeSecret,
        #[\SensitiveParameter] private string $serverMacKey,
        #[\SensitiveParameter] private string $clientMacKey,
        private string $transcriptHash,
    ) {
    }

    public function sessionKey(): string
    {
        return $this->sessionKey;
    }

    public function serverMacKey(): string
    {
        return $this->serverMacKey;
    }

    public function clientMacKey(): string
    {
        return $this->clientMacKey;
    }

    public function transcriptHash(): string
    {
        return $this->transcriptHash;
    }

    /** @return array<string, never> */
    public function __debugInfo(): array
    {
        return [];
    }

    /** @return never */
    public function __serialize(): array
    {
        throw new \LogicException('DerivedKeys must not be serialized.');
    }

    public function __unserialize(array $data): void
    {
        throw new \LogicException('DerivedKeys must not be unserialized.');
    }
}
