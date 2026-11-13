<?php

declare(strict_types=1);

namespace App\Storage;

/** Misconfigured storage settings. Messages never contain key material. */
final class StorageConfigException extends \RuntimeException
{
}
