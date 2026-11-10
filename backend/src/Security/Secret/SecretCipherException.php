<?php

declare(strict_types=1);

namespace App\Security\Secret;

/** A stored secret cannot be decrypted. The message never contains the value. */
final class SecretCipherException extends \RuntimeException
{
}
