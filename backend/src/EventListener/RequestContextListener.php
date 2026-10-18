<?php

declare(strict_types=1);

namespace App\EventListener;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\Routing\RequestContext;

/**
 * Absolute URLs that the router generates during a request (the OAuth redirect_uri of the knpu client bundle)
 * use the configured BACKEND_URL instead of the Host header (M2), exactly like `router.default_uri` does for
 * the CLI. Runs after the RouterListener (priority 32) so route matching still sees the real request.
 */
final class RequestContextListener
{
    public function __construct(
        private readonly RequestContext $context,
        #[Autowire(env: 'BACKEND_URL')]
        private readonly string $backendUrl,
    ) {
    }

    #[AsEventListener(event: 'kernel.request', priority: 31)]
    public function onKernelRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $parts = parse_url($this->backendUrl);
        if (!is_array($parts) || !isset($parts['host'])) {
            return;
        }
        $https = 'https' === ($parts['scheme'] ?? 'http');
        $this->context->setScheme($https ? 'https' : 'http');
        $this->context->setHost($parts['host']);
        if (isset($parts['port'])) {
            $https ? $this->context->setHttpsPort($parts['port']) : $this->context->setHttpPort($parts['port']);
        } else {
            $https ? $this->context->setHttpsPort(443) : $this->context->setHttpPort(80);
        }
        if (isset($parts['path']) && '' !== rtrim($parts['path'], '/')) {
            $this->context->setBaseUrl(rtrim($parts['path'], '/'));
        }
    }
}
