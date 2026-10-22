<?php

declare(strict_types=1);

namespace App\Controller;

use App\OAuth\OAuthConsentService;
use App\Security\CurrentUserResolver;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/** The apps (MCP clients) the signed-in user has connected. */
#[Route('/api/auth/mcp-grants')]
class McpGrantController extends AbstractApiController
{
    public function __construct(
        private readonly OAuthConsentService $consent,
        private readonly CurrentUserResolver $userResolver,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return new JsonResponse($this->consent->listGrants($this->userResolver->resolve()));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    public function delete(string $id): JsonResponse
    {
        $this->consent->deleteGrant($this->userResolver->resolve(), $id);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }
}
