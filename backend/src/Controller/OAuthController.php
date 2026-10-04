<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\OAuthAccountConflictException;
use App\OAuth\OidcResourceOwner;
use App\Security\NonceStore;
use App\Security\SignedTokenService;
use App\Service\AuthService;
use KnpU\OAuth2ClientBundle\Client\ClientRegistry;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * SSO sign-in (authorization code flow).
 *
 * CSRF / login CSRF: the start step issues an HMAC-signed `state` (purpose- and provider-bound, 10 minutes)
 * that carries a random nonce, and sets the same nonce in a short-lived HttpOnly cookie scoped to this
 * path on the API host. The callback accepts only a state that verifies, names the same provider, matches
 * the cookie of the browser that started the flow, and was not used before. A callback URL produced in an
 * attacker's own flow therefore fails in the victim's browser. The cookie is no session and carries no
 * credentials. Tokens are only ever sent to FRONTEND_URL.
 */
#[Route('/api/auth/oauth')]
class OAuthController extends AbstractController
{
    public const string STATE_COOKIE = 'oauth_state_nonce';
    private const string STATE_PURPOSE = 'oauth.state';
    private const int STATE_TTL = 600;

    public function __construct(
        private readonly ClientRegistry $clientRegistry,
        private readonly AuthService $authService,
        private readonly SignedTokenService $signedTokens,
        private readonly NonceStore $nonces,
        private readonly LoggerInterface $logger,
        private readonly string $frontendUrl,
    ) {
    }

    #[Route('/{provider}', name: 'oauth_redirect', methods: ['GET'])]
    public function start(string $provider): Response
    {
        try {
            $client = $this->clientRegistry->getClient($provider);
        } catch (\InvalidArgumentException) {
            return new Response('Unknown provider', 400);
        }

        $nonce = SignedTokenService::b64(random_bytes(32));
        $state = $this->signedTokens->issue(self::STATE_PURPOSE, ['n' => $nonce, 'prov' => $provider], self::STATE_TTL);
        $response = $client->redirect([], ['state' => $state]);
        $response->headers->setCookie($this->stateCookie($nonce, self::STATE_TTL));

        return $response;
    }

    #[Route('/{provider}/callback', name: 'oauth_callback', methods: ['GET', 'POST'])]
    public function callback(string $provider, Request $request): Response
    {
        if (!$this->stateIsValid($provider, $request)) {
            return $this->fail('invalid_state');
        }

        try {
            $client = $this->clientRegistry->getClient($provider);
            $resourceOwner = $client->fetchUser();
            if (!$resourceOwner instanceof OidcResourceOwner) {
                throw new \UnexpectedValueException('Unexpected resource owner');
            }
        } catch (\Throwable $e) {
            $this->logger->info('OAuth sign-in failed', ['provider' => $provider, 'exception' => $e]);

            return $this->fail('oauth_failed');
        }

        $email = $resourceOwner->getEmail();
        $providerId = $resourceOwner->getId();
        if (!$email || '' === $providerId) {
            return $this->fail('email_missing');
        }

        try {
            $tokens = $this->authService->findOrCreateOAuthUser(
                $provider,
                $providerId,
                $email,
                $resourceOwner->getName() ?? $email,
                $resourceOwner->isEmailVerified(),
            );
        } catch (OAuthAccountConflictException) {
            return $this->fail('account_exists');
        } catch (\Throwable $e) {
            $this->logger->error('OAuth sign-in failed', ['provider' => $provider, 'exception' => $e]);

            return $this->fail('oauth_failed');
        }

        $response = new RedirectResponse($this->frontendUrl.'/auth/callback?'.http_build_query([
            'token' => $tokens['access_token'],
            'refresh_token' => $tokens['refresh_token'],
        ]));
        $response->headers->setCookie($this->stateCookie('', -1));

        return $response;
    }

    private function stateIsValid(string $provider, Request $request): bool
    {
        $state = $request->query->get('state') ?? $request->request->get('state');
        $cookieNonce = $request->cookies->get(self::STATE_COOKIE);
        if (!is_string($state) || !is_string($cookieNonce) || '' === $cookieNonce) {
            return false;
        }
        $claims = $this->signedTokens->verify(self::STATE_PURPOSE, $state);
        if (null === $claims || ($claims['prov'] ?? null) !== $provider || !is_string($claims['n'] ?? null)) {
            return false;
        }
        if (!hash_equals($claims['n'], $cookieNonce)) {
            return false;
        }

        return $this->nonces->consume(self::STATE_PURPOSE, $claims['n'], $claims['exp']);
    }

    private function fail(string $code): RedirectResponse
    {
        $response = new RedirectResponse($this->frontendUrl.'/auth/callback?error='.$code);
        $response->headers->setCookie($this->stateCookie('', -1));

        return $response;
    }

    private function stateCookie(string $value, int $ttl): Cookie
    {
        // SameSite=None: Apple returns with a cross-site form POST, which drops Lax cookies.
        return Cookie::create(self::STATE_COOKIE)
            ->withValue($value)
            ->withExpires(time() + $ttl)
            ->withPath('/api/auth/oauth')
            ->withSecure(true)
            ->withHttpOnly(true)
            ->withSameSite(Cookie::SAMESITE_NONE);
    }
}
