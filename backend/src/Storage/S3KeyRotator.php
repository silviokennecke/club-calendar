<?php

declare(strict_types=1);

namespace App\Storage;

use Aws\Exception\AwsException;
use Aws\S3\S3Client;
use Psr\Log\LoggerInterface;
use Symfony\Component\Lock\LockFactory;

/**
 * Re-encrypts every object of the bucket (under the storage prefix) to the current SSE-C key by a server-side copy
 * onto itself. For each object the key that opens it is looked up with HEAD: the current key, each previous key,
 * then "no key" when `plain` is allowed. Idempotent; a lock keeps concurrent containers from working at once.
 * The client must be the raw one (no automatic SSE-C parameters).
 */
final class S3KeyRotator
{
    /** CopyObject handles objects up to 5 GiB; larger ones would need a multipart copy */
    public const MAX_COPY_SIZE = 5 * 1024 * 1024 * 1024;
    private const LOCK = 'storage-rotate-key';

    public function __construct(
        private readonly S3Client $client,
        private readonly LockFactory $lockFactory,
        private readonly StorageConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function rotate(bool $dryRun): RotationResult
    {
        $result = new RotationResult();
        if (!$this->config->isS3()) {
            $result->skipped = 'the storage source is not S3';

            return $result;
        }
        if (!$this->config->rotationRequired()) {
            $result->skipped = 'S3_SSE_C_KEY and S3_SSE_C_KEY_PREVIOUS are not both set';

            return $result;
        }

        $current = $this->config->sseC();
        \assert(null !== $current);
        // Candidates in order: null stands for "unencrypted"
        $candidates = [$current, ...$this->config->previousKeys()];
        if ($this->config->allowsPlain()) {
            $candidates[] = null;
        }

        $lock = $this->lockFactory->createLock(self::LOCK, 900, false);
        if (!$lock->acquire()) {
            $this->logger->info('Storage key rotation is already running elsewhere, skipping');
            $result->skipped = 'another container is rotating the keys';

            return $result;
        }

        try {
            $bucket = $this->config->bucket();
            $prefix = '' === $this->config->prefix() ? '' : $this->config->prefix().'/';
            $token = null;
            do {
                $page = $this->client->listObjectsV2(array_filter([
                    'Bucket' => $bucket,
                    'Prefix' => $prefix,
                    'ContinuationToken' => $token,
                ], static fn ($v) => null !== $v && '' !== $v));
                foreach ($page['Contents'] ?? [] as $object) {
                    $this->handle($bucket, (string) $object['Key'], (int) ($object['Size'] ?? 0), $current, $candidates, $dryRun, $result);
                }
                $lock->refresh(900);
                $token = ($page['IsTruncated'] ?? false) ? ($page['NextContinuationToken'] ?? null) : null;
            } while (null !== $token);
        } finally {
            $lock->release();
        }

        return $result;
    }

    /** @param list<SseCKey|null> $candidates */
    private function handle(string $bucket, string $key, int $size, SseCKey $current, array $candidates, bool $dryRun, RotationResult $result): void
    {
        ++$result->checked;
        $found = false;
        $etag = null;
        foreach ($candidates as $index => $candidate) {
            $head = $this->head($bucket, $key, $candidate);
            if (false === $head) {
                continue;
            }
            if (null === $head) {
                // Deleted while the rotation ran
                --$result->checked;

                return;
            }
            $found = true;
            $etag = $head['ETag'] ?? null;
            if (0 === $index) {
                ++$result->current;

                return;
            }
            $this->reencrypt($bucket, $key, $size, $candidate, $current, $etag, $dryRun, $result);

            return;
        }
        if (!$found) {
            $result->unreadable[] = $key;
        }
    }

    private function reencrypt(string $bucket, string $key, int $size, ?SseCKey $from, SseCKey $to, ?string $etag, bool $dryRun, RotationResult $result): void
    {
        if ($size > self::MAX_COPY_SIZE) {
            $result->tooLarge[] = $key;

            return;
        }
        if ($dryRun) {
            ++$result->rotated;

            return;
        }

        $params = [
            'Bucket' => $bucket,
            'Key' => $key,
            'CopySource' => $bucket.'/'.str_replace('%2F', '/', rawurlencode($key)),
            'MetadataDirective' => 'COPY',
            'SSECustomerAlgorithm' => SseCKey::ALGORITHM,
            'SSECustomerKey' => $to->raw(),
        ];
        if (null !== $from) {
            $params['CopySourceSSECustomerAlgorithm'] = SseCKey::ALGORITHM;
            $params['CopySourceSSECustomerKey'] = $from->raw();
        }
        if (null !== $etag) {
            $params['CopySourceIfMatch'] = $etag;
        }

        try {
            $this->client->copyObject($params);
            ++$result->rotated;
        } catch (AwsException $e) {
            if (412 === $e->getStatusCode()) {
                // Overwritten meanwhile (a write already uses the current key); the next run re-checks it
                ++$result->changedMeanwhile;

                return;
            }
            throw $this->sanitized($e);
        }
    }

    /**
     * @return array<string, mixed>|false|null the HEAD result, false when this key does not open the object, null when it is gone
     */
    private function head(string $bucket, string $key, ?SseCKey $with): array|false|null
    {
        $params = ['Bucket' => $bucket, 'Key' => $key];
        if (null !== $with) {
            $params['SSECustomerAlgorithm'] = SseCKey::ALGORITHM;
            $params['SSECustomerKey'] = $with->raw();
        }
        try {
            return $this->client->headObject($params)->toArray();
        } catch (AwsException $e) {
            return match ($e->getStatusCode()) {
                404 => null,
                400, 403 => false,
                default => throw $this->sanitized($e),
            };
        }
    }

    private function sanitized(AwsException $e): \RuntimeException
    {
        return new \RuntimeException(sprintf('S3 request failed: %s (HTTP %s)', $e->getAwsErrorCode() ?? 'unknown error', $e->getStatusCode() ?? '?'));
    }
}
