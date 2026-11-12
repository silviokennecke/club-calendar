<?php

declare(strict_types=1);

namespace App\Security;

final readonly class ClientContext
{
    public ?string $browser;
    public ?string $city;
    public ?string $country;
    /** Raw header for the security log only, never for mails or UI. */
    public ?string $userAgent;

    /** Browser, city and country are client-influenced: sanitized here, the single place all contexts pass. */
    public function __construct(
        public ?string $ip = null,
        ?string $browser = null,
        ?string $city = null,
        ?string $country = null,
        ?string $userAgent = null,
    ) {
        $this->browser = null === $browser ? null : ClientContextSanitizer::browser($browser);
        $this->city = ClientContextSanitizer::city($city);
        $this->country = ClientContextSanitizer::country($country);
        $this->userAgent = ClientContextSanitizer::userAgent($userAgent);
    }
}
