<?php

declare(strict_types=1);

namespace App\Controller;

use App\Service\PublicFeedService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/feed')]
class PublicFeedController extends AbstractController
{
    public function __construct(private readonly PublicFeedService $feedService)
    {
    }

    #[Route('/{feedId}/events', methods: ['GET'])]
    public function events(string $feedId, Request $request): JsonResponse
    {
        $secret = $request->query->get('secret');
        $tgParam = $request->query->get('targetGroupIds');
        $tgIds = $tgParam ? array_values(array_filter(array_map('trim', explode(',', $tgParam)))) : null;

        return new JsonResponse($this->feedService->getFeedEvents($feedId, $secret, $tgIds ?: null));
    }

    #[Route('/{feedId}/ics', methods: ['GET'])]
    public function ics(string $feedId, Request $request): Response
    {
        $secret = $request->query->get('secret');
        $tgParam = $request->query->get('targetGroupIds');
        $tgIds = $tgParam ? array_values(array_filter(array_map('trim', explode(',', $tgParam)))) : null;
        $icsContent = $this->feedService->getFeedIcs($feedId, $secret, $tgIds ?: null);

        return new Response($icsContent, 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"feed-$feedId.ics\"",
            'Cache-Control' => 'no-cache, no-store',
        ]);
    }
}
