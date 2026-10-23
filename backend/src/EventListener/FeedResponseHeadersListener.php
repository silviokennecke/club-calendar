<?php

declare(strict_types=1);

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * The one place for the crawler/referrer headers of the public feed API (`/api/feed/*`, error responses
 * included): `Referrer-Policy: no-referrer` always, `X-Robots-Tag: noindex` unless the feed may be
 * indexed. The web server sets only the Referrer-Policy for the SPA pages under `/feed/*`; their noindex
 * comes from a `<meta>` tag (from `feed.indexable` of the API).
 *
 * Whether a feed may be indexed (visibility PUBLIC) is decided by PublicFeedService after the
 * access checks; it stores the result in the request attribute INDEXABLE_ATTRIBUTE, so the feed is not
 * loaded twice. Without the attribute (unknown feed, 403/404, any error) the response is noindex.
 */
#[AsEventListener(event: KernelEvents::RESPONSE)]
class FeedResponseHeadersListener
{
    public const INDEXABLE_ATTRIBUTE = 'feed_indexable';

    public function __invoke(ResponseEvent $event): void
    {
        $request = $event->getRequest();
        if (!$event->isMainRequest() || !str_starts_with($request->getPathInfo(), '/api/feed/')) {
            return;
        }

        $response = $event->getResponse();
        $headers = $response->headers;
        $headers->set('Referrer-Policy', 'no-referrer');
        $robots = $this->robotsTag($request, $response);
        if (null === $robots) {
            $headers->remove('X-Robots-Tag');
        } else {
            $headers->set('X-Robots-Tag', $robots);
        }
    }

    /**
     * Value of `X-Robots-Tag` for a feed API response; null sends none (indexable feed). Only a
     * successful response (or 304) for a feed marked indexable goes without: errors (also a 400 after the feed
     * was loaded) and everything without the attribute are noindex.
     */
    private function robotsTag(Request $request, Response $response): ?string
    {
        $indexable = true === $request->attributes->get(self::INDEXABLE_ATTRIBUTE) && ($response->isSuccessful() || Response::HTTP_NOT_MODIFIED === $response->getStatusCode());

        return $indexable ? null : 'noindex';
    }
}
