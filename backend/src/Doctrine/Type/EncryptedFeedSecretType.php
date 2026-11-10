<?php

declare(strict_types=1);

namespace App\Doctrine\Type;

use App\Security\Secret\SecretCipher;

final class EncryptedFeedSecretType extends EncryptedSecretType
{
    public const string NAME = 'encrypted_feed_secret';

    protected function purpose(): string
    {
        return SecretCipher::PURPOSE_FEED;
    }
}
