<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;

/** Country from a proxy header (e.g. CF-IPCountry); only honoured when the request came through a trusted proxy. */
final class HeaderCountryLocationResolver implements LocationResolver
{
    public function __construct(
        #[Autowire('%env(CLIENT_COUNTRY_HEADER)%')]
        private readonly string $header,
    ) {
    }

    public function resolve(Request $request): Location
    {
        if ('' === $this->header || !$request->isFromTrustedProxy()) {
            return new Location();
        }
        $value = strtoupper(trim((string) $request->headers->get($this->header)));
        if (!preg_match('/^[A-Z]{2}$/', $value) || 'XX' === $value || 'T1' === $value) {
            return new Location();
        }

        return new Location(null, $value);
    }
}
