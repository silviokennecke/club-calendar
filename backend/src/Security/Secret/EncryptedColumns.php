<?php

declare(strict_types=1);

namespace App\Security\Secret;

/**
 * Every database column holding a SecretCipher value. A new encrypted column is registered here (a test checks
 * that each `encrypted_*` mapped field is listed); `app:secrets:rotate` re-encrypts exactly these.
 */
final class EncryptedColumns
{
    /** @return list<EncryptedColumn> */
    public static function all(): array
    {
        return [
            new EncryptedColumn('calendar_feed', 'shared_secret', 'id', SecretCipher::PURPOSE_FEED),
            new EncryptedColumn('member_subscription', 'secret', 'id', SecretCipher::PURPOSE_SUBSCRIPTION),
            new EncryptedColumn('user_totp', 'secret', 'id', SecretCipher::PURPOSE_TOTP),
        ];
    }
}
