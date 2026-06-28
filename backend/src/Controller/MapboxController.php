<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ProxyDeniedException;
use App\Exception\RateLimitExceededException;
use App\Service\Map\MapboxProxyService;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/mapbox')]
class MapboxController extends AbstractController
{
    /** @var string[] */
    private const array ALLOWED_DOMAINS = ['api.mapbox.com'];

    public function __construct(
        private readonly MapboxProxyService $proxyService,
        private readonly string $mapboxToken,
        private readonly LoggerInterface $logger,
    ) {
    }

    #[Route('/{domain}/{path}', name: 'mapbox_proxy', requirements: ['path' => '.+'], methods: ['GET', 'POST', 'PUT', 'PATCH'])]
    public function proxy(string $domain, string $path, Request $request): Response
    {
        if ('' === $this->mapboxToken) {
            return $this->errorResponse('Map service not configured', 503);
        }

        if (!in_array($domain, self::ALLOWED_DOMAINS, true)) {
            return $this->errorResponse('Domain not allowed', 400);
        }

        $queryParams = $request->query->all();
        unset($queryParams['access_token']);

        $body = $request->getContent() ?: null;
        $contentType = $request->headers->get('Content-Type', 'application/json');

        try {
            $result = $this->proxyService->proxy($path, $request->getMethod(), $queryParams, $body, $contentType);
        } catch (ProxyDeniedException) {
            return $this->errorResponse('Forbidden', 403);
        } catch (RateLimitExceededException) {
            return $this->errorResponse('Too many requests', 429);
        } catch (\Throwable $e) {
            $this->logger->error('Mapbox proxy failed', ['exception' => $e, 'path' => $path]);

            return $this->errorResponse('Failed to reach map service', 502);
        }

        return new Response($result->body, $result->status, $result->headers);
    }

    private function errorResponse(string $message, int $status): Response
    {
        return new Response(
            json_encode(['message' => $message]),
            $status,
            ['Content-Type' => 'application/json'],
        );
    }
}
