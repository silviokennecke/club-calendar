<?php

declare(strict_types=1);

namespace App\Exception;

use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * An HTTP error with a stable, machine-readable `code` (and optionally the input `field` it refers to)
 * next to the human-readable `detail` of the RFC 7807 body (see ExceptionListener).
 */
class ApiProblemException extends HttpException
{
    public function __construct(
        int $statusCode,
        string $message,
        private readonly string $errorCode,
        private readonly ?string $field = null,
    ) {
        parent::__construct($statusCode, $message);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    public function getField(): ?string
    {
        return $this->field;
    }
}
