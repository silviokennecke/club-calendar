<?php

declare(strict_types=1);

namespace App\Security;

use App\Http\ProblemResponse;
use Lexik\Bundle\JWTAuthenticationBundle\Event\AuthenticationFailureEvent;
use Lexik\Bundle\JWTAuthenticationBundle\Events;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;

/**
 * Replaces the JWT bundle's `{code: 401, message}` bodies by RFC 7807 problems with a stable `code`:
 * `missing_token` (no `Authorization` header), `invalid_token` (malformed, wrong signature, ended session,
 * user gone) and `token_expired`. The status stays 401 (the frontend refreshes on any 401).
 */
final class JwtProblemListener
{
    public const string MISSING_TOKEN_CODE = 'missing_token';
    public const string INVALID_TOKEN_CODE = 'invalid_token';
    public const string TOKEN_EXPIRED_CODE = 'token_expired';

    #[AsEventListener(event: Events::JWT_NOT_FOUND)]
    public function onNotFound(AuthenticationFailureEvent $event): void
    {
        $event->setResponse(self::unauthorized(self::MISSING_TOKEN_CODE, 'Not authenticated'));
    }

    #[AsEventListener(event: Events::JWT_INVALID)]
    public function onInvalid(AuthenticationFailureEvent $event): void
    {
        $event->setResponse(self::unauthorized(self::INVALID_TOKEN_CODE, 'Invalid access token'));
    }

    #[AsEventListener(event: Events::JWT_EXPIRED)]
    public function onExpired(AuthenticationFailureEvent $event): void
    {
        $event->setResponse(self::unauthorized(self::TOKEN_EXPIRED_CODE, 'Access token expired'));
    }

    /** 401 problem with `WWW-Authenticate: Bearer`. */
    public static function unauthorized(string $code, string $detail): JsonResponse
    {
        return ProblemResponse::create(401, $detail, ['code' => $code], ['WWW-Authenticate' => 'Bearer']);
    }
}
