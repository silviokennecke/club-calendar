<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Opaque\OpaqueReauthTickets;
use Symfony\Component\HttpFoundation\Request;

/**
 * Gated sessions (unconfirmed address, pending consent) may delete their account (DELETE /api/auth/me is allow-listed),
 * so the OPAQUE reauth for exactly that purpose must pass the gates too; every other purpose stays gated.
 */
final class ReauthGateAllowance
{
    private const array PATHS = ['/api/auth/opaque/reauth/start', '/api/auth/opaque/reauth/finish'];

    public static function allows(Request $request): bool
    {
        if ('POST' !== $request->getMethod() || !in_array(rtrim($request->getPathInfo(), '/'), self::PATHS, true)) {
            return false;
        }
        $body = json_decode($request->getContent(), true);

        return is_array($body) && OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT === ($body['purpose'] ?? null);
    }
}
