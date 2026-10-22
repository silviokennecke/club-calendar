<?php

declare(strict_types=1);

namespace App\OAuth;

use App\Entity\OAuthClient;
use App\Security\AuthRateLimiter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/** RFC 7591 dynamic client registration: public clients only (PKCE, no secret). */
#[AsController]
class OAuthRegistrationController
{
    public const int MAX_REDIRECT_URIS = 5;
    public const int MAX_CLIENT_NAME = 100;
    private const int MAX_BODY = 16384;
    private const string DEFAULT_NAME = 'MCP client';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly RedirectUriPolicy $policy,
        private readonly AuthRateLimiter $limiter,
    ) {
    }

    #[Route('/api/oauth/register', methods: ['POST'])]
    public function register(Request $request): JsonResponse
    {
        $this->limiter->assertClientRegistrationAllowed($request);

        try {
            $data = $this->body($request);
            $name = $this->clientName($data);
            [$uris, $family] = $this->redirectUris($data);
            $this->checkMetadata($data);
        } catch (OAuthRegistrationException $e) {
            return OAuthResponse::error($e->error, $e->getMessage(), 400);
        }

        $client = new OAuthClient($name, $uris, $this->clock->now()->setTimezone(new \DateTimeZone('UTC')), self::ANY === $family ? null : $family);
        $this->em->persist($client);
        $this->em->flush();

        $response = [
            'client_id' => $client->getId(),
            'client_id_issued_at' => $client->getCreatedAt()->getTimestamp(),
            'client_name' => $name,
            'redirect_uris' => $uris,
            'token_endpoint_auth_method' => 'none',
            'grant_types' => ['authorization_code', 'refresh_token'],
            'response_types' => ['code'],
        ];
        if (is_string($data['scope'] ?? null) && '' !== trim($data['scope'])) {
            $response['scope'] = McpScope::toString(McpScope::parse($data['scope']) ?? []);
        }

        return OAuthResponse::noStore(new JsonResponse($response, 201));
    }

    private const string ANY = RedirectUriPolicy::ANY;

    /** @return array<string, mixed> */
    private function body(Request $request): array
    {
        $raw = $request->getContent();
        if (strlen($raw) > self::MAX_BODY) {
            throw new OAuthRegistrationException('invalid_client_metadata', 'Request body is too large');
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || array_is_list($data)) {
            throw new OAuthRegistrationException('invalid_client_metadata', 'Body must be a JSON object');
        }

        return $data;
    }

    /** @param array<string, mixed> $data */
    private function clientName(array $data): string
    {
        $name = $data['client_name'] ?? self::DEFAULT_NAME;
        if (!is_string($name)) {
            throw new OAuthRegistrationException('invalid_client_metadata', 'client_name must be a string');
        }
        $name = trim((string) preg_replace('/[\x00-\x1f\x7f]+/u', ' ', $name));
        if ('' === $name) {
            return self::DEFAULT_NAME;
        }
        if (mb_strlen($name) > self::MAX_CLIENT_NAME) {
            throw new OAuthRegistrationException('invalid_client_metadata', sprintf('client_name must be at most %d characters', self::MAX_CLIENT_NAME));
        }

        return $name;
    }

    /**
     * @param array<string, mixed> $data
     *
     * @return array{0: list<string>, 1: string}
     */
    private function redirectUris(array $data): array
    {
        $uris = $data['redirect_uris'] ?? null;
        if (!is_array($uris) || !array_is_list($uris) || [] === $uris) {
            throw new OAuthRegistrationException('invalid_redirect_uri', 'redirect_uris must be a non-empty array');
        }
        if (count($uris) > self::MAX_REDIRECT_URIS) {
            throw new OAuthRegistrationException('invalid_redirect_uri', sprintf('At most %d redirect_uris are allowed', self::MAX_REDIRECT_URIS));
        }
        $families = [];
        foreach ($uris as $uri) {
            $family = is_string($uri) ? $this->policy->match($uri) : null;
            if (null === $family) {
                throw new OAuthRegistrationException('invalid_redirect_uri', 'A redirect URI is invalid or not allowed for this server');
            }
            $families[$family] = true;
        }
        if (count($families) > 1) {
            throw new OAuthRegistrationException('invalid_redirect_uri', 'redirect_uris must all belong to the same client');
        }

        return [array_values(array_unique($uris)), (string) array_key_first($families)];
    }

    /** @param array<string, mixed> $data */
    private function checkMetadata(array $data): void
    {
        if (isset($data['token_endpoint_auth_method']) && 'none' !== $data['token_endpoint_auth_method']) {
            throw new OAuthRegistrationException('invalid_client_metadata', 'Only token_endpoint_auth_method "none" is supported');
        }
        if (isset($data['grant_types'])) {
            $grants = $data['grant_types'];
            if (!is_array($grants) || !in_array('authorization_code', $grants, true)
                || [] !== array_diff($grants, ['authorization_code', 'refresh_token'])) {
                throw new OAuthRegistrationException('invalid_client_metadata', 'grant_types must contain authorization_code and may contain refresh_token');
            }
        }
        if (isset($data['response_types']) && $data['response_types'] !== ['code']) {
            throw new OAuthRegistrationException('invalid_client_metadata', 'response_types must be ["code"]');
        }
        if (isset($data['scope']) && (!is_string($data['scope']) || ('' !== trim($data['scope']) && null === McpScope::parse($data['scope'])))) {
            throw new OAuthRegistrationException('invalid_client_metadata', 'Unknown scope');
        }
    }
}
