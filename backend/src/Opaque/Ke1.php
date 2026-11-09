<?php

declare(strict_types=1);

namespace App\Opaque;

/** KE1 (96 B): blinded_element | client_nonce | client_keyshare. */
final readonly class Ke1
{
    public const int LENGTH = 96;

    private function __construct(
        public string $blindedElement,
        public string $clientNonce,
        public string $clientKeyshare,
        public string $bytes,
    ) {
    }

    public static function fromBytes(string $bytes): self
    {
        if (self::LENGTH !== strlen($bytes)) {
            throw new InvalidMessageException('KE1 must be 96 bytes.');
        }
        $blinded = substr($bytes, 0, 32);
        $keyshare = substr($bytes, 64, 32);
        try {
            Ristretto::assertElement($blinded);
            Ristretto::assertElement($keyshare);
        } catch (OpaqueException $e) {
            throw new InvalidMessageException('KE1 contains an invalid element.', 0, $e);
        }

        return new self($blinded, substr($bytes, 32, 32), $keyshare, $bytes);
    }
}
