<?php

declare(strict_types=1);

namespace App\Doctrine\Type;

use App\Security\Secret\SecretCipher;

final class EncryptedTotpSecretType extends EncryptedSecretType
{
    public const string NAME = 'encrypted_totp_secret';

    protected function purpose(): string
    {
        return SecretCipher::PURPOSE_TOTP;
    }
}
