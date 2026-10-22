<?php

declare(strict_types=1);

namespace App\OAuth;

use App\Entity\OAuthClient;
use App\Repository\OAuthClientRepository;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

/** Token (RFC 6749) and revocation (RFC 7009) endpoints for public clients: form-encoded, `client_id` only. */
#[AsController]
class OAuthTokenController
{
    public function __construct(
        private readonly OAuthServerService $oauth,
        private readonly OAuthClientRepository $clients,
    ) {
    }

    #[Route('/api/oauth/token', methods: ['POST'])]
    public function token(Request $request): JsonResponse
    {
        try {
            $client = $this->client($request);
            $grantType = self::param($request, 'grant_type');
            $resource = self::param($request, 'resource', false);

            $tokens = match ($grantType) {
                'authorization_code' => $this->oauth->exchangeCode(
                    $client,
                    self::param($request, 'code'),
                    self::param($request, 'redirect_uri'),
                    self::param($request, 'code_verifier'),
                    $resource,
                ),
                'refresh_token' => $this->oauth->refresh($client, self::param($request, 'refresh_token'), $resource),
                default => throw new OAuthException(OAuthException::UNSUPPORTED_GRANT_TYPE, 'grant_type must be authorization_code or refresh_token'),
            };
        } catch (OAuthException $e) {
            return OAuthResponse::error($e->getError(), $e->getDescription(), $e->getStatus());
        }

        return OAuthResponse::noStore(new JsonResponse($tokens));
    }

    #[Route('/api/oauth/revoke', methods: ['POST'])]
    public function revoke(Request $request): Response
    {
        $token = $request->request->get('token');
        if (!is_string($token) || '' === $token) {
            return OAuthResponse::error(OAuthException::INVALID_REQUEST, 'token is required', 400);
        }
        $hint = $request->request->get('token_type_hint');
        if (null !== $hint && !in_array($hint, ['access_token', 'refresh_token'], true)) {
            return OAuthResponse::error('unsupported_token_type', 'token_type_hint must be access_token or refresh_token', 400);
        }
        $clientId = $request->request->get('client_id');
        $client = null;
        if (is_string($clientId) && '' !== $clientId) {
            $client = Uuid::isValid($clientId) ? $this->clients->find($clientId) : null;
            if (null === $client) {
                // Unknown client: nothing can match, answer like for any unknown token
                return OAuthResponse::noStore(new Response('', 200));
            }
        }
        $this->oauth->revokeToken($token, $client);

        return OAuthResponse::noStore(new Response('', 200));
    }

    /** @throws OAuthException */
    private function client(Request $request): OAuthClient
    {
        $id = self::param($request, 'client_id');
        $client = Uuid::isValid($id) ? $this->clients->find($id) : null;
        if (null === $client) {
            throw new OAuthException(OAuthException::INVALID_CLIENT, 'Unknown client_id');
        }

        return $client;
    }

    /**
     * @return ($required is true ? string : ?string)
     *
     * @throws OAuthException
     */
    private static function param(Request $request, string $name, bool $required = true): ?string
    {
        $value = $request->request->all()[$name] ?? null;
        if (null === $value || '' === $value) {
            if ($required) {
                throw new OAuthException(OAuthException::INVALID_REQUEST, sprintf('%s is required', $name));
            }

            return null;
        }
        if (!is_string($value)) {
            throw new OAuthException(OAuthException::INVALID_REQUEST, sprintf('%s must be a single value', $name));
        }

        return $value;
    }
}
