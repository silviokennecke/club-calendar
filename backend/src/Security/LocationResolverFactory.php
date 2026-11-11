<?php

declare(strict_types=1);

namespace App\Security;

/** A MaxMind licence key means "MaxMind only": no fallback to the proxy header. */
final class LocationResolverFactory
{
    public function __construct(
        private readonly MaxMindLocationResolver $maxMind,
        private readonly HeaderCountryLocationResolver $header,
    ) {
    }

    public function create(string $licenseKey): LocationResolver
    {
        return '' !== trim($licenseKey) ? $this->maxMind : $this->header;
    }
}
