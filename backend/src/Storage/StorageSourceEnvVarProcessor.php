<?php

declare(strict_types=1);

namespace App\Storage;

use Symfony\Component\DependencyInjection\EnvVarProcessorInterface;
use Symfony\Component\DependencyInjection\Exception\RuntimeException;

/** `%env(storage_source:STORAGE_SOURCE)%`: storage.local or storage.s3, anything else fails with a clear message. */
final class StorageSourceEnvVarProcessor implements EnvVarProcessorInterface
{
    public function getEnv(string $prefix, string $name, \Closure $getEnv): string
    {
        $value = trim((string) $getEnv($name));
        if (!in_array($value, [StorageConfig::LOCAL, StorageConfig::S3], true)) {
            throw new RuntimeException(sprintf('%s must be "%s" or "%s", got "%s".', $name, StorageConfig::LOCAL, StorageConfig::S3, $value));
        }

        return $value;
    }

    public static function getProvidedTypes(): array
    {
        return ['storage_source' => 'string'];
    }
}
