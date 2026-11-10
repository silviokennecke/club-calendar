<?php

declare(strict_types=1);

namespace App\Doctrine\Type;

use App\Security\Secret\SecretCipher;
use Doctrine\DBAL\Platforms\AbstractPlatform;
use Doctrine\DBAL\Types\StringType;

/**
 * A VARCHAR column that holds a secret encrypted by SecretCipher; entities see plaintext. Subclasses fix the
 * purpose (associated data) of their column. Legacy plaintext rows are read as is. DBAL types are static singletons,
 * so the cipher is reached through a provider set by the Kernel at boot (resolved lazily on first use).
 */
abstract class EncryptedSecretType extends StringType
{
    /** @var (\Closure(): SecretCipher)|null */
    private static ?\Closure $cipherProvider = null;

    /** @param \Closure(): SecretCipher $provider */
    public static function useCipherProvider(\Closure $provider): void
    {
        self::$cipherProvider = $provider;
    }

    abstract protected function purpose(): string;

    public function convertToDatabaseValue(mixed $value, AbstractPlatform $platform): ?string
    {
        return null === $value ? null : self::cipher()->encrypt((string) $value, $this->purpose());
    }

    public function convertToPHPValue(mixed $value, AbstractPlatform $platform): ?string
    {
        return null === $value ? null : self::cipher()->decrypt((string) $value, $this->purpose());
    }

    private static function cipher(): SecretCipher
    {
        return (self::$cipherProvider ?? throw new \LogicException('EncryptedSecretType has no cipher provider (Kernel::boot).'))();
    }
}
