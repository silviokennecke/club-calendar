<?php

declare(strict_types=1);

namespace App\Exception;

/** The map image provider failed; the message never contains the request URL (it carries the token). */
class MapImageUnavailableException extends \RuntimeException
{
}
