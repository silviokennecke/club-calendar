<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\AuthRateLimiter;
use App\Service\PersonalFeedService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\Routing\Attribute\Route;

/** The personal subscription as ICS behind its secret address (public firewall, no JWT). */
class PersonalFeedController extends AbstractController
{
    public function __construct(
        private readonly PersonalFeedService $personal,
        private readonly AuthRateLimiter $rateLimiter,
    ) {
    }

    #[Route('/api/feed/me/{subscriptionId}/ics', methods: ['GET'], requirements: ['subscriptionId' => '[^/]+'], priority: 10)]
    public function ics(string $subscriptionId, Request $request): Response
    {
        $this->rateLimiter->assertFeedAllowed($request, $subscriptionId);
        // an array value (?secret[]=) is just a wrong secret
        $plan = $this->personal->prepareIcs($subscriptionId, $request->query->all()['secret'] ?? null);

        $apply = static function (Response $r) use ($plan): void {
            $r->setEtag($plan->etag);
            $r->headers->set('Cache-Control', 'private, no-cache');
        };
        $notModified = new Response();
        $apply($notModified);
        if ($notModified->isNotModified($request)) {
            return $notModified;
        }

        $response = new StreamedResponse($this->personal->icsOutput($this->personal->streamIcs($plan)));
        $apply($response);
        $response->headers->set('Content-Type', 'text/calendar; charset=utf-8');
        $response->headers->set('Content-Disposition', 'attachment; filename="my-subscription.ics"');

        return $response;
    }
}
