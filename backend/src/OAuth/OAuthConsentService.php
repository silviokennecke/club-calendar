<?php

declare(strict_types=1);

namespace App\OAuth;

use App\Entity\McpGrant;
use App\Entity\OAuthAuthorizationRequest;
use App\Entity\User;
use App\EventListener\ConsentGateListener;
use App\Exception\ApiProblemException;
use App\Repository\McpGrantRepository;
use App\Repository\OAuthAuthorizationRequestRepository;
use App\Security\AuthRateLimiter;
use App\Service\LegalDocumentService;
use App\Service\Quota;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Component\Uid\Uuid;

/** The signed-in side of the OAuth flow: consent page data, the decision, and the user's connected apps. */
class OAuthConsentService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ClockInterface $clock,
        private readonly OAuthServerService $oauth,
        private readonly OAuthAuthorizationRequestRepository $requests,
        private readonly McpGrantRepository $grants,
        private readonly LegalDocumentService $legal,
        private readonly Quota $quota,
        private readonly AuthRateLimiter $limiter,
    ) {
    }

    /** @return array<string, mixed> */
    public function describeRequest(string $id): array
    {
        $request = $this->openRequest($id);
        $client = $request->getClient();

        return [
            'id' => $request->getId(),
            'label' => RedirectUriPolicy::label($client->getFamily()),
            'claimedName' => $client->getClientName(),
            'redirectHost' => self::redirectHost($request->getRedirectUri()),
            'family' => $client->getFamily(),
            'callbackRisk' => RedirectUriPolicy::callbackRisk($request->getRedirectUri()),
            'scopes' => explode(' ', $request->getScopes()),
            'createdAt' => $request->getCreatedAt()->format(DATE_ATOM),
            'expiresAt' => $request->getExpiresAt()->format(DATE_ATOM),
        ];
    }

    /** @return string the URL to send the browser to (the client's redirect URI with code or error) */
    public function decide(User $user, string $requestId, bool $approve): string
    {
        $this->limiter->assertOAuthDecisionAllowed($user->getId());
        $request = $this->openRequest($requestId);

        if (!$approve) {
            $this->oauth->deny($request);

            return OAuthAuthorizeController::redirectUrl($request->getRedirectUri(), ['error' => 'access_denied', 'error_description' => 'The user denied the request', 'state' => $request->getState()]);
        }
        // Strict, independent of the session's `lc` claim: a new grant needs consent to the current documents.
        $pending = $this->legal->pendingConsents($user);
        if ([] !== $pending) {
            throw ConsentGateListener::required($pending);
        }
        if (!$user->isEmailVerified()) {
            throw new ApiProblemException(403, 'The e-mail address is not confirmed', 'email_not_verified', null, [], null, ['email' => $user->getEmail()]);
        }

        try {
            $result = $this->em->wrapInTransaction(function () use ($user, $request): array {
                // A new grant replaces the user's open one for the same client; ended ones do not count.
                $this->grants->deleteReplaceable($user->getId(), $request->getClient()->getId(), $this->now());
                $this->quota->assertRoom(Quota::MCP_CLIENTS_PER_USER, $user);

                return $this->oauth->approve($request, $user);
            });
        } catch (OAuthException) {
            throw self::notFound();
        }

        return OAuthAuthorizeController::redirectUrl($result['redirectUri'], ['code' => $result['code'], 'state' => $result['state']]);
    }

    /** @return list<array<string, mixed>> */
    public function listGrants(User $user): array
    {
        return array_map(static fn (McpGrant $g) => [
            'id' => $g->getId(),
            'label' => RedirectUriPolicy::label($g->getClient()->getFamily()),
            'claimedName' => $g->getClient()->getClientName(),
            'redirectHost' => self::redirectHost($g->getClient()->getRedirectUris()[0] ?? ''),
            'family' => $g->getClient()->getFamily(),
            'scopes' => explode(' ', $g->getScopes()),
            'createdAt' => $g->getCreatedAt()->format(DATE_ATOM),
            'lastUsedAt' => $g->getLastUsedAt()?->format(DATE_ATOM),
        ], $this->grants->findActiveOfUser($user->getId(), $this->now()));
    }

    /** Removes the grant with all its tokens (the row goes, so it no longer counts against the quota). */
    public function deleteGrant(User $user, string $id): void
    {
        $grant = Uuid::isValid($id) ? $this->grants->findOneByIdForUser($id, $user->getId()) : null;
        if (null === $grant) {
            throw new ApiProblemException(404, 'Connected app not found', 'mcp_grant_not_found');
        }
        $this->em->remove($grant);
        $this->em->flush();
    }

    private function openRequest(string $id): OAuthAuthorizationRequest
    {
        $request = Uuid::isValid($id) ? $this->requests->find($id) : null;
        if (null === $request || $request->getExpiresAt() <= $this->now()) {
            throw self::notFound();
        }

        return $request;
    }

    private static function notFound(): ApiProblemException
    {
        return new ApiProblemException(404, 'Authorization request not found or expired', 'authorization_request_not_found');
    }

    private static function redirectHost(string $uri): string
    {
        $parts = parse_url($uri);
        if (null === RedirectUriPolicy::parse($uri)) {
            return is_array($parts) ? ($parts['scheme'] ?? $uri).':' : $uri;
        }

        return $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');
    }

    private function now(): \DateTimeImmutable
    {
        return $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
    }
}
