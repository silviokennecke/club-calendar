<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Exception\ProxyDeniedException;
use App\Exception\RateLimitExceededException;
use App\Security\AuthRateLimiter;
use App\Service\Map\MapAvailability;
use App\Service\Map\MapboxProxyService;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/mapbox')]
class MapboxController extends AbstractController
{
    /** @var string[] */
    private const array ALLOWED_DOMAINS = ['api.mapbox.com'];

    public function __construct(
        private readonly MapboxProxyService $proxyService,
        private readonly MapAvailability $mapAvailability,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly LoggerInterface $logger,
    ) {
    }

    #[Route('/{domain}/{path}', name: 'mapbox_proxy', requirements: ['path' => '.+'], methods: ['GET'])]
    public function proxy(string $domain, string $path, Request $request): Response
    {
        if (!$this->mapAvailability->isConfigured()) {
            throw MapAvailability::unavailable();
        }

        if (!in_array($domain, self::ALLOWED_DOMAINS, true)) {
            throw new ApiProblemException(400, 'Domain not allowed', 'invalid_request', 'domain');
        }

        $user = $this->getUser();
        $kind = $this->proxyService->classify($path);
        if ($user instanceof User && 'tile' === $kind) {
            $this->rateLimiter->assertMapboxTilesAllowed($request, $user->getId());
        } elseif ($user instanceof User && 'style' === $kind) {
            $this->rateLimiter->assertMapboxStyleAllowed($user->getId());
        }

        $queryParams = $request->query->all();
        unset($queryParams['access_token']);

        try {
            $result = $this->proxyService->proxy($path, 'GET', $queryParams, null, 'application/json');
        } catch (ProxyDeniedException) {
            throw new AccessDeniedHttpException('Path not allowed');
        } catch (RateLimitExceededException) {
            throw MapController::rateLimited();
        } catch (\Throwable $e) {
            $this->logger->error('Mapbox proxy failed', ['exception' => $e, 'path' => $path]);

            throw new HttpException(502, 'Failed to reach map service', $e);
        }

        return new Response($result->body, $result->status, $result->headers);
    }
}
