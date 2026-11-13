<?php

declare(strict_types=1);

namespace App\Storage;

/** A customer-provided S3 encryption key (AES-256, 32 raw bytes). Never printed, serialized or put into messages. */
final class SseCKey
{
    public const ALGORITHM = 'AES256';

    private function __construct(private readonly string $raw)
    {
    }

    public static function fromBase64(#[\SensitiveParameter] string $base64, string $variable = 'S3_SSE_C_KEY'): self
    {
        $raw = base64_decode(trim($base64), true);
        if (false === $raw || 32 !== strlen($raw)) {
            throw new StorageConfigException(sprintf('%s must be the base64 encoding of exactly 32 random bytes (generate one with: openssl rand -base64 32).', $variable));
        }

        return new self($raw);
    }

    /** Raw key bytes; the AWS SDK base64-encodes them and adds the MD5 header itself. */
    public function raw(): string
    {
        return $this->raw;
    }

    /** Base64 of the MD5 digest, as sent in the *-Customer-Key-MD5 headers. */
    public function md5Base64(): string
    {
        return base64_encode(md5($this->raw, true));
    }

    public function equals(self $other): bool
    {
        return hash_equals($this->raw, $other->raw);
    }

    /** @return array<string, string> */
    public function __debugInfo(): array
    {
        return ['key' => '***'];
    }

    public function __serialize(): array
    {
        throw new \LogicException('An SSE-C key cannot be serialized.');
    }
}
