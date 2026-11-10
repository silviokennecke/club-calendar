<?php

declare(strict_types=1);

namespace App\Doctrine\Type;

use App\Security\Secret\SecretCipher;

final class EncryptedSubscriptionSecretType extends EncryptedSecretType
{
    public const string NAME = 'encrypted_subscription_secret';

    protected function purpose(): string
    {
        return SecretCipher::PURPOSE_SUBSCRIPTION;
    }
}
