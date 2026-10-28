<?php

declare(strict_types=1);

namespace App\Exception;

use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * An HTTP error with a stable, machine-readable `code` (and optionally the input `field` it refers to)
 * next to the human-readable `detail` of the RFC 7807 body (see ExceptionListener).
 *
 * Codes used by the API (list for the frontend: docs/api/openapi.yaml, schema ErrorCode):
 * validation_failed, unknown_reference, duplicate_name, too_many_events, quota_exceeded (with `resource`, `limit`), email_taken, invalid_credentials,
 * email_not_verified, email_verification_required (with `email`), invalid_refresh_token, invalid_grant, invalid_passkey, invalid_passkey_registration,
 * passkey_already_registered, passkey_not_found, invalid_request, invalid_reset_token, no_password,
 * last_login_method, oauth_account_not_found, unknown_provider, invalid_state / account_in_use /
 * already_linked (SSO link-complete), invalid_verification_code, verification_resend_too_early (with `retryAt`),
 * consent_required / consent_outdated (with `documents`) / legal_document_not_found, last_member / last_member_of_club / last_admin / last_admin_of_club / invalid_role (422), forbidden (403, role too low in a service check), invitation_not_found / invitation_expired, rate_limited, map_unavailable (503, no MAPBOX_TOKEN: geocoding and Mapbox proxy).
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
        /** @var array<string, mixed> additional body members next to `code`/`field` (e.g. `retryAt`, `email`, `documents`) */
        private readonly array $extra = [],
    ) {
        parent::__construct($statusCode, $message, $previous, $headers);
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }

    /** @return array<string, mixed> */
    public function getExtra(): array
    {
        return $this->extra;
    }

    public function getField(): ?string
    {
        return $this->field;
    }
}
