<?php

declare(strict_types=1);

namespace App\Storage;

/**
 * Storage settings of the active source. SSE-C keys are parsed on demand, so a malformed key fails at first use
 * (and only for the S3 source: with local storage the S3_* variables are ignored).
 */
final class StorageConfig
{
    public const LOCAL = 'storage.local';
    public const S3 = 'storage.s3';
    public const PLAIN = 'plain';

    public function __construct(
        private readonly string $source,
        private readonly string $endpoint,
        private readonly string $bucket,
        private readonly string $prefix,
        #[\SensitiveParameter] private readonly string $sseCKey,
        #[\SensitiveParameter] private readonly string $sseCPrevious,
    ) {
    }

    public function source(): string
    {
        return $this->source;
    }

    public function isS3(): bool
    {
        return self::S3 === $this->source;
    }

    public function bucket(): string
    {
        return $this->bucket;
    }

    public function prefix(): string
    {
        return trim($this->prefix, '/');
    }

    public function endpointHost(): string
    {
        $host = '' === trim($this->endpoint) ? '' : parse_url(trim($this->endpoint), PHP_URL_HOST);

        return is_string($host) && '' !== $host ? $host : 'AWS S3 (default endpoint)';
    }

    public function sseCEnabled(): bool
    {
        return $this->isS3() && '' !== trim($this->sseCKey);
    }

    public function sseC(): ?SseCKey
    {
        return $this->sseCEnabled() ? SseCKey::fromBase64($this->sseCKey) : null;
    }

    /** @return list<SseCKey> older keys, without duplicates of the current one */
    public function previousKeys(): array
    {
        $current = $this->sseC();
        $keys = [];
        foreach ($this->previousEntries() as $entry) {
            if (self::PLAIN === $entry) {
                continue;
            }
            $key = SseCKey::fromBase64($entry, 'S3_SSE_C_KEY_PREVIOUS');
            if (null !== $current && $key->equals($current)) {
                continue;
            }
            $keys[] = $key;
        }

        return $keys;
    }

    /** Objects may still be unencrypted (enabling SSE-C on an existing bucket) */
    public function allowsPlain(): bool
    {
        return in_array(self::PLAIN, $this->previousEntries(), true);
    }

    /** The cheap decision: rotation matters only for S3 with a current key and a non-empty previous list */
    public function rotationRequired(): bool
    {
        return $this->sseCEnabled() && [] !== $this->previousEntries();
    }

    /** @return list<string> */
    private function previousEntries(): array
    {
        $entries = [];
        foreach (explode(',', $this->sseCPrevious) as $entry) {
            $entry = trim($entry);
            if ('' !== $entry) {
                $entries[] = $entry;
            }
        }

        return $entries;
    }
}
