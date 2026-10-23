<?php

declare(strict_types=1);

namespace App\Service;

/** E-mail addresses are stored and looked up trimmed and lower-cased, so plain equality is enough. */
final class EmailAddress
{
    public static function normalize(string $email): string
    {
        return mb_strtolower(trim($email));
    }
}
