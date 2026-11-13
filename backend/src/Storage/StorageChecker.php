<?php

declare(strict_types=1);

namespace App\Storage;

use Aws\Exception\AwsException;
use League\Flysystem\FilesystemOperator;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** Writes, reads back and deletes a probe object through the active storage. */
final class StorageChecker
{
    public function __construct(
        #[Autowire(service: 'app.storage', lazy: true)] private readonly FilesystemOperator $storage,
        private readonly StorageConfig $config,
    ) {
    }

    /** @return list<string> description lines (no credentials, no keys) */
    public function describe(): array
    {
        if (!$this->config->isS3()) {
            return ['Source: local files (STORAGE_LOCAL_PATH)'];
        }

        return [
            'Source: S3',
            'Endpoint: '.$this->config->endpointHost(),
            'Bucket: '.('' === $this->config->bucket() ? '(not set)' : $this->config->bucket()),
            'Prefix: '.('' === $this->config->prefix() ? '(none)' : $this->config->prefix()),
            'SSE-C: '.($this->config->sseCEnabled() ? 'on' : 'off'),
        ];
    }

    /** @throws \RuntimeException with a concise reason */
    public function probe(): void
    {
        if ($this->config->isS3() && '' === $this->config->bucket()) {
            throw new \RuntimeException('S3_BUCKET is not set.');
        }
        $path = '.storage-check/'.bin2hex(random_bytes(8)).'.txt';
        $payload = 'club-calendar storage check '.bin2hex(random_bytes(8));
        try {
            $this->config->sseC(); // a malformed key fails here with its own message
            $this->storage->write($path, $payload);
            if ($this->storage->read($path) !== $payload) {
                throw new StorageProbeException('The probe object read back differs from what was written.');
            }
        } catch (StorageConfigException|StorageProbeException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new \RuntimeException($this->reason($e));
        } finally {
            try {
                $this->storage->delete($path);
            } catch (\Throwable) {
            }
        }
    }

    private function reason(\Throwable $e): string
    {
        for ($c = $e; null !== $c; $c = $c->getPrevious()) {
            if ($c instanceof AwsException) {
                if (null === $c->getAwsErrorCode()) {
                    return 'S3 request failed: '.mb_substr((string) strtok($c->getMessage(), "\n"), 0, 200);
                }

                return sprintf('S3 request failed: %s (HTTP %s)', $c->getAwsErrorCode() ?? 'unknown error', $c->getStatusCode() ?? '?');
            }
        }
        $message = strtok($e->getMessage(), "\n");

        return sprintf('%s: %s', (new \ReflectionClass($e))->getShortName(), false === $message ? '' : $message);
    }
}
