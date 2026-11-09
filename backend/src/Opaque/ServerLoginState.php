<?php

declare(strict_types=1);

namespace App\Opaque;

/** State kept between KE2 and KE3 (128 B serialised: session_key | expected_client_mac). */
final class ServerLoginState
{
    public const int LENGTH = 128;

    public function __construct(
        #[\SensitiveParameter] private string $sessionKey,
        #[\SensitiveParameter] private string $expectedClientMac,
    ) {
        if (64 !== strlen($sessionKey) || 64 !== strlen($expectedClientMac)) {
            throw new OpaqueException('Invalid server login state.');
        }
    }

    public static function fromBytes(#[\SensitiveParameter] string $bytes): self
    {
        if (self::LENGTH !== strlen($bytes)) {
            throw new InvalidMessageException('Server login state must be 128 bytes.');
        }

        return new self(substr($bytes, 0, 64), substr($bytes, 64, 64));
    }

    public function toBytes(): string
    {
        return $this->sessionKey.$this->expectedClientMac;
    }

    /** @internal consumed by {@see OpaqueServer::serverFinish()} */
    public function sessionKey(): string
    {
        return $this->sessionKey;
    }

    /** @internal */
    public function expectedClientMac(): string
    {
        return $this->expectedClientMac;
    }

    /** @return array<string, never> */
    public function __debugInfo(): array
    {
        return [];
    }

    /** @return never */
    public function __serialize(): array
    {
        throw new \LogicException('ServerLoginState must be sealed via toBytes(), not serialized.');
    }
}
