<?php

declare(strict_types=1);

namespace App\Exception;

class EmailNotVerifiedException extends \RuntimeException
{
    public function __construct()
    {
        parent::__construct('Email not verified');
    }
}
