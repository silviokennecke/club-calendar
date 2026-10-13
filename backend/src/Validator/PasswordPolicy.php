<?php

declare(strict_types=1);

namespace App\Validator;

use Symfony\Component\Validator\Constraints as Assert;
use Symfony\Component\Validator\Constraints\Compound;

/**
 * The one password policy (registration, reset, change): 8 to 128 characters.
 *
 * The maximum keeps hashing cheap (no multi-kilobyte inputs). bcrypt itself only reads 72 bytes; Symfony's
 * NativePasswordHasher pre-hashes longer passwords (SHA-512, base64) so that every character counts.
 */
#[\Attribute(\Attribute::TARGET_PROPERTY | \Attribute::TARGET_METHOD)]
final class PasswordPolicy extends Compound
{
    public const int MIN = 8;
    public const int MAX = 128;

    protected function getConstraints(array $options): array
    {
        return [
            new Assert\NotBlank(),
            new Assert\Length(min: self::MIN, max: self::MAX),
        ];
    }
}
