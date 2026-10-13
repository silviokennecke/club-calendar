<?php

declare(strict_types=1);

namespace App\Exception;

use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * An HTTP error with a stable, machine-readable `code` (and optionally the input `field` it refers to)
 * next to the human-readable `detail` of the RFC 7807 body (see ExceptionListener).
 *
 * Codes used by the API (list for the frontend: docs/redesign/BACKEND-GAPS.md, "Fehlercodes"):
 * validation_failed, unknown_reference, duplicate_name, too_many_events, email_taken, invalid_credentials,
 * email_not_verified, invalid_refresh_token, invalid_grant, invalid_passkey, invalid_passkey_registration,
 * passkey_already_registered, passkey_not_found, invalid_request.
 */
class ApiProblemException extends HttpException
{
    public function __construct(
        int $statusCode,
        string $message,
        private readonly string $errorCode,
        private readonly ?string $field = null,
        array $headers = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($statusCode, $message, $previous, $headers);
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
