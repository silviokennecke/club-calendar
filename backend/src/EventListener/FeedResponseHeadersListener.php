<?php

declare(strict_types=1);

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * The one place for the crawler/referrer headers of the public feed API (`/api/feed/*`, error responses
 * included): `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. The web server sets only the
 * Referrer-Policy for the SPA pages under `/feed/*`; their noindex comes from a `<meta>` tag.
 *
 * The robots value is decided in robotsTag(): later it can depend on the feed (e.g. its status or an
 * indexing option) instead of being fixed.
 */
#[AsEventListener(event: KernelEvents::RESPONSE)]
class FeedResponseHeadersListener
{
    public function __invoke(ResponseEvent $event): void
    {
        $request = $event->getRequest();
        if (!$event->isMainRequest() || !str_starts_with($request->getPathInfo(), '/api/feed/')) {
            return;
        }

        $headers = $event->getResponse()->headers;
        $headers->set('Referrer-Policy', 'no-referrer');
        $robots = $this->robotsTag($request);
        if (null !== $robots) {
            $headers->set('X-Robots-Tag', $robots);
        }
    }

    /** Value of `X-Robots-Tag` for a feed API request; null sends none. */
    private function robotsTag(Request $request): ?string
    {
        return 'noindex';
    }
}
