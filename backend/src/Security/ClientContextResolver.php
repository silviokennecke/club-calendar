<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\HttpFoundation\RequestStack;

class ClientContextResolver
{
    public function __construct(
        private readonly RequestStack $requestStack,
        private readonly LocationResolver $locationResolver,
    ) {
    }

    /** Captured eagerly: deferred mails run after the response. Empty context in the CLI. */
    public function current(): ClientContext
    {
        $request = $this->requestStack->getCurrentRequest();
        if (null === $request) {
            return new ClientContext();
        }
        $ua = (string) $request->headers->get('User-Agent');
        $location = $this->locationResolver->resolve($request);

        return new ClientContext(
            $request->getClientIp(),
            '' === $ua ? null : UserAgentSummary::browser(substr($ua, 0, 512)),
            $location->city,
            $location->country,
        );
    }
}
