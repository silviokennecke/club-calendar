<?php

declare(strict_types=1);

namespace App\OAuth;

/** An RFC 6749 / 8707 error: `error` code and `error_description` for the token or authorization response. */
class OAuthException extends \RuntimeException
{
    public const string INVALID_REQUEST = 'invalid_request';
    public const string INVALID_CLIENT = 'invalid_client';
    public const string INVALID_GRANT = 'invalid_grant';
    public const string INVALID_SCOPE = 'invalid_scope';
    public const string INVALID_TARGET = 'invalid_target';
    public const string UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type';

    public function __construct(private readonly string $error, private readonly string $description)
    {
        parent::__construct($error.': '.$description);
    }

    public function getError(): string
    {
        return $this->error;
    }

    public function getDescription(): string
    {
        return $this->description;
    }

    public function getStatus(): int
    {
        return self::INVALID_CLIENT === $this->error ? 401 : 400;
    }
}
