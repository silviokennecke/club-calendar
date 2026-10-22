<?php

declare(strict_types=1);

namespace App\OAuth;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

/** RFC 6749 style JSON responses of the token, registration and revocation endpoints (never cacheable). */
final class OAuthResponse
{
    public static function error(string $error, string $description, int $status): JsonResponse
    {
        return self::noStore(new JsonResponse(['error' => $error, 'error_description' => $description], $status));
    }

    /** @template T of Response @param T $response @return T */
    public static function noStore(Response $response): Response
    {
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('Pragma', 'no-cache');

        return $response;
    }
}
