<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\AuthRateLimiter;
use App\Service\PublicFeedService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/feed')]
class PublicFeedController extends AbstractController
{
    public function __construct(private readonly PublicFeedService $feedService, private readonly AuthRateLimiter $rateLimiter)
    {
    }

    #[Route('/{feedId}/events', methods: ['GET'])]
    public function events(string $feedId, Request $request): JsonResponse
    {
        $this->rateLimiter->assertFeedAllowed($request, $feedId);
        $secret = $request->query->get('secret');
        $tgParam = $request->query->get('targetGroupIds');
        $tgIds = $tgParam ? array_values(array_filter(array_map('trim', explode(',', $tgParam)))) : null;

        return new JsonResponse($this->feedService->getFeedEvents(
            $feedId,
            $secret,
            $tgIds ?: null,
            // raw values (also arrays): checked strictly as YYYY-MM-DD after the access check
            $request->query->all()['from'] ?? null,
            $request->query->all()['to'] ?? null,
        ));
    }

    #[Route('/{feedId}/events/{eventId}', methods: ['GET'])]
    public function event(string $feedId, string $eventId, Request $request): JsonResponse
    {
        $this->rateLimiter->assertFeedAllowed($request, $feedId);

        return new JsonResponse($this->feedService->getFeedEvent($feedId, $eventId, $this->queryString($request, 'secret')));
    }

    /** A scalar query parameter (an array such as ?from[]= is a 400 from InputBag). */
    private function queryString(Request $request, string $key): ?string
    {
        $value = $request->query->get($key);

        return null === $value ? null : (string) $value;
    }

    #[Route('/{feedId}/ics', methods: ['GET'])]
    public function ics(string $feedId, Request $request): Response
    {
        $this->rateLimiter->assertFeedAllowed($request, $feedId);
        $secret = $request->query->get('secret');
        $plan = $this->feedService->prepareFeedIcs($feedId, $secret, PublicFeedService::normalizeTargetGroupIds($request->query->get('targetGroupIds')));

        $apply = function (Response $r) use ($plan): void {
            $r->setEtag($plan->etag);
            // no-cache: always revalidate (cheap 304); private for secret feeds so shared caches never keep them
            $r->headers->set('Cache-Control', $plan->feed->getVisibility()->requiresSecret() ? 'private, no-cache' : 'public, no-cache');
        };
        $notModified = new Response();
        $apply($notModified);
        if ($notModified->isNotModified($request)) {
            return $notModified;
        }

        // Access and ETag are decided; the events are read while streaming (no Content-Length)
        $response = new StreamedResponse($this->feedService->icsOutput($this->feedService->streamFeedIcs($plan)));
        $apply($response);
        $response->headers->set('Content-Type', 'text/calendar; charset=utf-8');
        $response->headers->set('Content-Disposition', "attachment; filename=\"feed-$feedId.ics\"");

        return $response;
    }
}
