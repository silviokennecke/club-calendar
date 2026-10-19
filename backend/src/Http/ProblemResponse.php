<?php

declare(strict_types=1);

namespace App\Http;

use Symfony\Component\HttpFoundation\JsonResponse;

/**
 * RFC 7807 body `{type, title, status, detail, code?, field?}` (`application/problem+json`), the one error
 * shape of the API (ExceptionListener, JWT failures).
 */
final class ProblemResponse
{
    /**
     * @param array<string, mixed>  $extra   stable members such as `code` / `field` (RFC 7807 extensions)
     * @param array<string, string> $headers e.g. WWW-Authenticate of a 401, Allow of a 405
     */
    public static function create(int $status, string $detail, array $extra = [], array $headers = []): JsonResponse
    {
        return new JsonResponse([
            'type' => 'https://tools.ietf.org/html/rfc2616#section-10',
            'title' => self::title($status),
            'status' => $status,
            'detail' => $detail,
        ] + $extra, $status, ['Content-Type' => 'application/problem+json'] + $headers);
    }

    public static function title(int $status): string
    {
        return match ($status) {
            400 => 'Bad Request',
            401 => 'Unauthorized',
            403 => 'Forbidden',
            404 => 'Not Found',
            405 => 'Method Not Allowed',
            409 => 'Conflict',
            413 => 'Content Too Large',
            422 => 'Unprocessable Entity',
            429 => 'Too Many Requests',
            500 => 'Internal Server Error',
            502 => 'Bad Gateway',
            503 => 'Service Unavailable',
            default => 'HTTP Error',
        };
    }
}
