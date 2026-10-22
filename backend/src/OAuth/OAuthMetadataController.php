<?php

declare(strict_types=1);

namespace App\OAuth;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Discovery documents for MCP clients (RFC 8414, RFC 9728). All URLs come from APP_URL/BACKEND_URL, never
 * from the request.
 */
#[AsController]
class OAuthMetadataController
{
    public function __construct(
        private readonly OAuthServerService $oauth,
        #[Autowire(env: 'APP_URL')]
        private readonly string $appUrl,
        #[Autowire(env: 'BACKEND_URL')]
        private readonly string $backendUrl,
    ) {
    }

    #[Route('/.well-known/oauth-authorization-server', methods: ['GET'])]
    public function authorizationServer(): JsonResponse
    {
        $api = rtrim($this->backendUrl, '/').'/api/oauth';

        return $this->json([
            'issuer' => rtrim($this->appUrl, '/'),
            'authorization_endpoint' => $api.'/authorize',
            'token_endpoint' => $api.'/token',
            'registration_endpoint' => $api.'/register',
            'revocation_endpoint' => $api.'/revoke',
            'response_types_supported' => ['code'],
            'grant_types_supported' => ['authorization_code', 'refresh_token'],
            'code_challenge_methods_supported' => ['S256'],
            'token_endpoint_auth_methods_supported' => ['none'],
            'revocation_endpoint_auth_methods_supported' => ['none'],
            'scopes_supported' => array_map(static fn (McpScope $s) => $s->value, McpScope::cases()),
            'resource_indicators_supported' => true,
        ]);
    }

    #[Route('/.well-known/oauth-protected-resource', methods: ['GET'])]
    #[Route('/.well-known/oauth-protected-resource/api/mcp', methods: ['GET'])]
    public function protectedResource(): JsonResponse
    {
        return $this->json([
            'resource' => $this->oauth->canonicalResource(),
            'authorization_servers' => [rtrim($this->appUrl, '/')],
            'scopes_supported' => array_map(static fn (McpScope $s) => $s->value, McpScope::cases()),
            'bearer_methods_supported' => ['header'],
            'resource_name' => 'Club Calendar',
        ]);
    }

    /** @param array<string, mixed> $data */
    private function json(array $data): JsonResponse
    {
        $response = new JsonResponse($data, 200, [], false);
        $response->setPublic();
        $response->setMaxAge(300);

        return $response;
    }
}
