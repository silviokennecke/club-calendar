<?php

declare(strict_types=1);

namespace App\OAuth;

use App\Exception\ApiProblemException;
use App\Repository\OAuthClientRepository;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/**
 * Authorization endpoint (RFC 6749 3.1, OAuth 2.1) and the consent API behind the SPA page `/oauth/consent`.
 * The browser lands on `GET /api/oauth/authorize`, is sent on to the SPA with an authorization request id and
 * the SPA answers with `POST /api/oauth/authorize/decision`. Errors about client_id / redirect_uri are never
 * redirected (400); all other errors go to the verified redirect URI.
 */
#[AsController]
class OAuthAuthorizeController
{
    public function __construct(
        private readonly OAuthServerService $oauth,
        private readonly OAuthConsentService $consent,
        private readonly OAuthClientRepository $clients,
        private readonly AuthRateLimiter $limiter,
        private readonly CurrentUserResolver $userResolver,
        #[Autowire(env: 'FRONTEND_URL')]
        private readonly string $frontendUrl,
    ) {
    }

    #[Route('/api/oauth/authorize', methods: ['GET'])]
    public function authorize(Request $request): RedirectResponse
    {
        $this->limiter->assertOtherAllowed($request);
        $q = $request->query->all();

        $clientId = self::param($q, 'client_id');
        $client = null !== $clientId && Uuid::isValid($clientId) ? $this->clients->find($clientId) : null;
        if (null === $client) {
            throw new ApiProblemException(400, 'Unknown client_id', 'invalid_request', 'client_id');
        }
        $redirectUri = self::param($q, 'redirect_uri');
        if (null === $redirectUri || !$this->oauth->redirectUriRegistered($client, $redirectUri)) {
            throw new ApiProblemException(400, 'redirect_uri is missing or not registered for this client', 'invalid_request', 'redirect_uri');
        }
        $state = self::param($q, 'state');

        try {
            if ('code' !== self::param($q, 'response_type')) {
                throw new OAuthException('unsupported_response_type', 'response_type must be code');
            }
            $authRequest = $this->oauth->createAuthorizationRequest(
                $client,
                $redirectUri,
                self::param($q, 'scope'),
                self::param($q, 'code_challenge') ?? '',
                self::param($q, 'code_challenge_method'),
                $state,
                self::param($q, 'resource'),
            );
        } catch (OAuthException $e) {
            return new RedirectResponse(self::redirectUrl($redirectUri, ['error' => $e->getError(), 'error_description' => $e->getDescription(), 'state' => $state]));
        }

        return new RedirectResponse(rtrim($this->frontendUrl, '/').'/oauth/consent?request='.$authRequest->getId());
    }

    #[Route('/api/oauth/authorization-request/{id}', methods: ['GET'])]
    public function describe(string $id): JsonResponse
    {
        $this->userResolver->resolve();

        return new JsonResponse($this->consent->describeRequest($id));
    }

    #[Route('/api/oauth/authorize/decision', methods: ['POST'])]
    public function decision(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = json_decode($request->getContent(), true);
        if (!is_array($data) || !is_string($data['requestId'] ?? null) || !is_bool($data['approve'] ?? null)) {
            throw new ApiProblemException(400, 'requestId (string) and approve (boolean) are required', 'invalid_request');
        }

        return new JsonResponse(['redirectUrl' => $this->consent->decide($user, $data['requestId'], $data['approve'])]);
    }

    /** @param array<string, string|null> $params null values are left out */
    public static function redirectUrl(string $redirectUri, array $params): string
    {
        $query = http_build_query(array_filter($params, static fn (?string $v) => null !== $v), '', '&', PHP_QUERY_RFC3986);

        return $redirectUri.(str_contains($redirectUri, '?') ? '&' : '?').$query;
    }

    /** A single, non-empty string parameter; anything else (missing, empty, array) counts as absent. */
    private static function param(array $query, string $name): ?string
    {
        $v = $query[$name] ?? null;

        return is_string($v) && '' !== $v ? $v : null;
    }
}
