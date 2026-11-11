<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Exception\OAuthAccountConflictException;
use App\Exception\OAuthIdentityMismatchException;
use App\Exception\OAuthRegistrationRestrictedException;
use App\OAuth\OidcProvider;
use App\OAuth\OidcResourceOwner;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Security\NonceStore;
use App\Security\OneTimeTokenService;
use App\Security\SignedTokenService;
use App\Service\AccountService;
use App\Service\AuthService;
use App\Service\FeedProof;
use App\Service\RegistrationPolicy;
use Doctrine\ORM\EntityManagerInterface;
use KnpU\OAuth2ClientBundle\Client\ClientRegistry;
use KnpU\OAuth2ClientBundle\Client\OAuth2ClientInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\JsonResponse;
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
 * credentials. A successful sign-in redirects to FRONTEND_URL/auth/callback?code=<one-time code> (OAUTH_LOGIN_CODE_TTL,
 * single use, bound to user and session version); the frontend redeems it with POST /api/auth/token
 * (grant_type=one_time_token). No access or refresh token ever appears in a URL.
 *
 * OIDC nonce: every start (sign-in and link) also draws a fresh random `nonce`, sends it to the provider and
 * keeps it in the signed state (`on`). The callback tells the provider object to expect exactly that value
 * and the ID token's `nonce` claim must match (OidcProvider), so an ID token minted for another flow is
 * refused even if its code were injected here.
 *
 * The state cookie only covers the provider callback. The login code is bound to the browser that started
 * the flow separately (PKCE style, S256): the start request must carry `code_challenge` (else
 * FRONTEND_URL/auth/callback?error=invalid_request), the signed state carries it into the code, and the
 * redemption needs the matching `code_verifier`, which only the starting tab holds in its sessionStorage.
 *
 * Errors go to FRONTEND_URL/auth/callback?error=<code>: invalid_state, provider_denied (user cancelled at
 * the provider), provider_error (other error from the provider), oauth_failed (code exchange / profile
 * failed), email_missing, account_exists, email_unverified_at_provider (Google/Apple say the address is
 * not verified there, so an existing account is not linked), registration_restricted (RESTRICT_REGISTRATION: a new account needs an open club
 * invitation for the address; existing accounts and linking are not affected).
 * A provider that does not prove the address (Microsoft) gets the normal code too: the confirmation code is
 * mailed and the redeemed session is restricted until `POST /api/auth/verify-email`.
 *
 * Linking (signed in, profile): POST /{provider}/link-start (JWT) returns {url}, a one-time ticket URL on
 * this API (60 s, bound to user and session version). Opening it in the browser sets the state cookie and
 * redirects to the provider, like the sign-in start. The ticket goes through a top-level navigation
 * because a cross-origin fetch cannot set the cookie (CORS without credentials). The link state is signed
 * for its own purpose ("oauth.link_state"): it never verifies as a sign-in state and vice versa, so a link
 * flow never issues tokens and a sign-in flow never links to a signed-in account. The callback does NOT
 * link yet: it redirects to FRONTEND_URL/profile?link_provider=<provider>&link_proof=<proof> (signed, 5 min,
 * single use, names user, session version and provider account), and the signed-in frontend completes
 * the link with POST /{provider}/link-complete {proof} (JWT): only when the JWT's user is the user who
 * started the flow. Without this step anyone could start a link flow with their own session and send the
 * ticket URL to a victim: the victim's browser would sign in at the provider and attach the VICTIM's
 * provider account to the ATTACKER's user (the victim's later SSO sign-in would land in the attacker's
 * account). The provider account (provider + sub) is linked regardless of the provider's email_verified
 * (the signed-in user controls both accounts). Errors of the redirect: FRONTEND_URL/profile?link_error=<code>
 * (invalid_state, provider_denied, provider_error, oauth_failed); errors of link-complete as API problems:
 * 400 invalid_state (proof forged, expired, used, or for another user / session), 409 account_in_use (the
 * provider account belongs to another user; nothing about that account is revealed), 409 already_linked
 * (another account of this provider is linked).
 * DELETE /{provider} (JWT) unlinks, as long as another sign-in method remains (409 last_login_method).
 */
#[Route('/api/auth/oauth')]
class OAuthController extends AbstractController
{
    public const string STATE_COOKIE = 'oauth_state_nonce';
    private const string STATE_PURPOSE = 'oauth.state';
    private const string LINK_STATE_PURPOSE = 'oauth.link_state';
    private const string LINK_TICKET_PURPOSE = 'oauth.link_ticket';
    private const string LINK_PROOF_PURPOSE = 'oauth.link_proof';
    private const int LINK_PROOF_TTL = 300;
    private const int STATE_TTL = 600;
    private const int LINK_TICKET_TTL = 60;

    public function __construct(
        private readonly ClientRegistry $clientRegistry,
        private readonly AuthService $authService,
        private readonly SignedTokenService $signedTokens,
        private readonly NonceStore $nonces,
        private readonly LoggerInterface $logger,
        private readonly CurrentUserResolver $userResolver,
        private readonly AccountService $accounts,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly EntityManagerInterface $em,
        private readonly RegistrationPolicy $registrationPolicy,
        private readonly string $frontendUrl,
        #[Autowire(env: 'BACKEND_URL')]
        private readonly string $backendUrl,
    ) {
    }

    #[Route('/{provider}/link-start', name: 'oauth_link_start', methods: ['POST'])]
    public function linkStart(string $provider): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->assertKnownProvider($provider);
        $ticket = $this->signedTokens->issue(self::LINK_TICKET_PURPOSE, [
            'n' => SignedTokenService::b64(random_bytes(32)),
            'prov' => $provider,
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
        ], self::LINK_TICKET_TTL);

        return new JsonResponse([
            'url' => rtrim($this->backendUrl, '/').'/api/auth/oauth/'.rawurlencode($provider).'/link?'.http_build_query(['ticket' => $ticket]),
        ]);
    }

    #[Route('/{provider}/link', name: 'oauth_link_redirect', methods: ['GET'])]
    public function linkRedirect(string $provider, Request $request): Response
    {
        $client = $this->knownClient($provider);
        $ticket = $request->query->get('ticket');
        $claims = is_string($ticket) ? $this->signedTokens->verify(self::LINK_TICKET_PURPOSE, $ticket) : null;
        if (null === $claims || ($claims['prov'] ?? null) !== $provider || !is_string($claims['n'] ?? null)
            || null === $this->sessionUser($claims)
            || !$this->nonces->consume(self::LINK_TICKET_PURPOSE, $claims['n'], $claims['exp'])) {
            return $this->failLink('invalid_state');
        }

        $nonce = SignedTokenService::b64(random_bytes(32));
        $oidcNonce = SignedTokenService::b64(random_bytes(32));
        $state = $this->signedTokens->issue(self::LINK_STATE_PURPOSE, [
            'n' => $nonce,
            'on' => $oidcNonce,
            'prov' => $provider,
            'uid' => $claims['uid'],
            'tv' => $claims['tv'],
        ], self::STATE_TTL);
        $response = $client->redirect([], $this->authorizeOptions($provider, $state, $oidcNonce));
        $response->headers->setCookie($this->stateCookie($nonce, self::STATE_TTL));

        return $response;
    }

    /**
     * Second half of a link flow, in the signed-in frontend: links the provider account of the proof
     * (issued by the link callback) when the caller is the user who started the flow (same session
     * version). A flow started by someone else ends here (400 invalid_state).
     */
    #[Route('/{provider}/link-complete', name: 'oauth_link_complete', methods: ['POST'])]
    public function linkComplete(string $provider, Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = json_decode($request->getContent(), true);
        $proof = is_array($data) ? ($data['proof'] ?? null) : null;
        $claims = is_string($proof) && '' !== $proof ? $this->signedTokens->verify(self::LINK_PROOF_PURPOSE, $proof) : null;
        if (null === $claims
            || ($claims['prov'] ?? null) !== $provider
            || ($claims['uid'] ?? null) !== $user->getId()
            || ($claims['tv'] ?? null) !== $user->getTokenVersion()
            || !is_string($claims['n'] ?? null)
            || !is_string($claims['sub'] ?? null) || '' === $claims['sub']
            || !$this->nonces->consume(self::LINK_PROOF_PURPOSE, $claims['n'], $claims['exp'])) {
            throw new ApiProblemException(400, 'The link could not be completed', 'invalid_state');
        }
        $email = is_string($claims['email'] ?? null) ? $claims['email'] : null;
        $error = $this->authService->linkOAuthAccount($user, $provider, $claims['sub'], $email, is_string($claims['tid'] ?? null) ? $claims['tid'] : null, is_string($claims['oid'] ?? null) ? $claims['oid'] : null);
        if (null !== $error) {
            throw new ApiProblemException(409, 'The account could not be linked', $error);
        }

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/{provider}', name: 'oauth_unlink', methods: ['DELETE'])]
    public function unlink(string $provider): JsonResponse
    {
        $this->accounts->unlinkProvider($this->userResolver->resolve(), $provider);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/{provider}', name: 'oauth_redirect', methods: ['GET'])]
    public function start(string $provider, Request $request): Response
    {
        $this->rateLimiter->assertOtherAllowed($request);
        $client = $this->knownClient($provider);

        // PKCE-style binding of the login code to this browser: without a challenge nothing starts.
        $challenge = $request->query->all()['code_challenge'] ?? null;
        if (!OneTimeTokenService::isWellFormedChallenge($challenge)) {
            return $this->fail('invalid_request');
        }

        // Feed proof for a new account under RESTRICT_REGISTRATION: validated now, re-validated at the callback. The
        // state is only signed (the provider sees it), so it carries the SHA-256 of the secret, not the secret.
        $feedClaims = [];
        if ($this->registrationPolicy->isRestricted()) {
            $proof = FeedProof::fromInput(['feedId' => $request->query->get('feed_id'), 'secret' => $request->query->get('secret')]);
            if (null !== $proof) {
                try {
                    if (null !== $proof->secret) {
                        $this->rateLimiter->assertFeedAllowed($request, $proof->feedId);
                    }
                    $valid = $this->registrationPolicy->proofAllowsSignup($proof);
                } catch (ApiProblemException) {
                    $valid = false; // throttled: a browser redirect cannot show a 429, so no proof
                }
                if ($valid) {
                    $feedClaims = ['fid' => $proof->feedId, 'fs' => null === $proof->secret ? null : hash('sha256', $proof->secret)];
                }
            }
        }

        $nonce = SignedTokenService::b64(random_bytes(32));
        $oidcNonce = SignedTokenService::b64(random_bytes(32));
        $state = $this->signedTokens->issue(self::STATE_PURPOSE, ['n' => $nonce, 'on' => $oidcNonce, 'prov' => $provider, 'cc' => $challenge] + $feedClaims, self::STATE_TTL);
        $response = $client->redirect([], $this->authorizeOptions($provider, $state, $oidcNonce));
        $response->headers->setCookie($this->stateCookie($nonce, self::STATE_TTL));

        return $response;
    }

    #[Route('/{provider}/callback', name: 'oauth_callback', methods: ['GET', 'POST'])]
    public function callback(string $provider, Request $request): Response
    {
        $this->rateLimiter->assertOtherAllowed($request);
        $claims = $this->validState(self::STATE_PURPOSE, $provider, $request);
        if (null === $claims) {
            $linkClaims = $this->validState(self::LINK_STATE_PURPOSE, $provider, $request);

            return null === $linkClaims ? $this->fail('invalid_state') : $this->linkCallback($provider, $request, $linkClaims);
        }

        // The provider sends the user back with ?error=… instead of a code (RFC 6749 4.1.2.1), e.g. when
        // the user cancelled the consent screen (access_denied).
        $providerError = $request->query->get('error') ?? $request->request->get('error');
        if (is_string($providerError) && '' !== $providerError) {
            $this->logger->info('OAuth provider returned an error', ['provider' => $provider, 'error' => $providerError]);

            return $this->fail('access_denied' === $providerError ? 'provider_denied' : 'provider_error');
        }

        try {
            $resourceOwner = $this->fetchOwner($provider, $claims);
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
            $user = $this->authService->findOrCreateOAuthUser(
                $provider,
                $providerId,
                $email,
                $resourceOwner->getName() ?? $email,
                $resourceOwner->isEmailVerified(),
                true,
                'microsoft' === $provider ? $resourceOwner->getTenantId() : null,
                'microsoft' === $provider ? $resourceOwner->getObjectId() : null,
                is_string($claims['fid'] ?? null) ? new FeedProof($claims['fid'], null, is_string($claims['fs'] ?? null) ? $claims['fs'] : null) : null,
            );
        } catch (OAuthIdentityMismatchException) {
            return $this->fail('oauth_failed');
        } catch (OAuthAccountConflictException $e) {
            return $this->fail($e->unverifiedAtProvider ? 'email_unverified_at_provider' : 'account_exists');
        } catch (OAuthRegistrationRestrictedException) {
            return $this->fail('registration_restricted');
        } catch (\Throwable $e) {
            $this->logger->error('OAuth sign-in failed', ['provider' => $provider, 'exception' => $e]);

            return $this->fail('oauth_failed');
        }

        if (!OneTimeTokenService::isWellFormedChallenge($claims['cc'] ?? null)) {
            return $this->fail('invalid_state');
        }

        $response = new RedirectResponse($this->frontendUrl.'/auth/callback?'.http_build_query([
            'code' => $this->authService->issueOAuthLoginCode($user, $claims['cc'], $provider),
        ]));
        $response->headers->setCookie($this->stateCookie('', -1));

        return $response;
    }

    /**
     * Link mode: never issues tokens and does not link yet. The provider account goes back to the
     * frontend as a signed proof for the user named in the state (who must still exist with the same
     * session version); the signed-in frontend completes the link ({@see linkComplete()}).
     *
     * @param array<string, mixed> $claims
     */
    private function linkCallback(string $provider, Request $request, array $claims): Response
    {
        $providerError = $request->query->get('error') ?? $request->request->get('error');
        if (is_string($providerError) && '' !== $providerError) {
            $this->logger->info('OAuth provider returned an error (link)', ['provider' => $provider, 'error' => $providerError]);

            return $this->failLink('access_denied' === $providerError ? 'provider_denied' : 'provider_error');
        }
        $user = $this->sessionUser($claims);
        if (null === $user) {
            return $this->failLink('invalid_state');
        }
        try {
            $resourceOwner = $this->fetchOwner($provider, $claims);
            if (!$resourceOwner instanceof OidcResourceOwner || '' === $resourceOwner->getId()) {
                throw new \UnexpectedValueException('Unexpected resource owner');
            }
        } catch (\Throwable $e) {
            $this->logger->info('OAuth link failed', ['provider' => $provider, 'exception' => $e]);

            return $this->failLink('oauth_failed');
        }

        $proof = $this->signedTokens->issue(self::LINK_PROOF_PURPOSE, [
            'n' => SignedTokenService::b64(random_bytes(32)),
            'prov' => $provider,
            'uid' => $user->getId(),
            'tv' => $user->getTokenVersion(),
            'sub' => $resourceOwner->getId(),
            'email' => $resourceOwner->getEmail(),
            'tid' => 'microsoft' === $provider ? $resourceOwner->getTenantId() : null,
            'oid' => 'microsoft' === $provider ? $resourceOwner->getObjectId() : null,
        ], self::LINK_PROOF_TTL);
        $response = new RedirectResponse($this->frontendUrl.'/profile?'.http_build_query(['link_provider' => $provider, 'link_proof' => $proof]));
        $response->headers->setCookie($this->stateCookie('', -1));

        return $response;
    }

    /**
     * Code exchange and profile with the nonce of this flow (from the signed state) as the only one the
     * ID token may carry.
     *
     * @param array<string, mixed> $stateClaims
     */
    private function fetchOwner(string $provider, array $stateClaims): mixed
    {
        $oidcNonce = $stateClaims['on'] ?? null;
        if (!is_string($oidcNonce) || '' === $oidcNonce) {
            throw new \UnexpectedValueException('State carries no nonce');
        }
        $client = $this->clientRegistry->getClient($provider);
        $oidc = $client->getOAuth2Provider();
        if (!$oidc instanceof OidcProvider) {
            throw new \UnexpectedValueException('Unexpected provider');
        }
        $oidc->expectNonce($oidcNonce);

        return $client->fetchUser();
    }

    /** @param array<string, mixed> $claims */
    private function sessionUser(array $claims): ?User
    {
        if (!is_string($claims['uid'] ?? null) || !is_int($claims['tv'] ?? null)) {
            return null;
        }
        $user = $this->em->getRepository(User::class)->find($claims['uid']);

        return null !== $user && $user->getTokenVersion() === $claims['tv'] ? $user : null;
    }

    private function assertKnownProvider(string $provider): void
    {
        $this->knownClient($provider);
    }

    /**
     * The OAuth client of a configured provider; 404 `unknown_provider` (RFC 7807) otherwise, also on the
     * browser routes (sign-in start, link ticket): the frontend only links to the providers it got from
     * `GET /api/auth/providers`, so an unknown name is a broken link, not a sign-in error to show.
     */
    private function knownClient(string $provider): OAuth2ClientInterface
    {
        try {
            return $this->clientRegistry->getClient($provider);
        } catch (\InvalidArgumentException) {
            throw new ApiProblemException(404, 'Unknown provider', 'unknown_provider');
        }
    }

    /**
     * Claims of a state that verifies for the purpose, names this provider, matches the browser's cookie
     * and was not used before (it is consumed here); null otherwise.
     *
     * @return array<string, mixed>|null
     */
    private function validState(string $purpose, string $provider, Request $request): ?array
    {
        $state = $request->query->get('state') ?? $request->request->get('state');
        $cookieNonce = $request->cookies->get(self::STATE_COOKIE);
        if (!is_string($state) || !is_string($cookieNonce) || '' === $cookieNonce) {
            return null;
        }
        $claims = $this->signedTokens->verify($purpose, $state);
        if (null === $claims || ($claims['prov'] ?? null) !== $provider || !is_string($claims['n'] ?? null)) {
            return null;
        }
        if (!hash_equals($claims['n'], $cookieNonce)) {
            return null;
        }

        return $this->nonces->consume($purpose, $claims['n'], $claims['exp']) ? $claims : null;
    }

    private function failLink(string $code): RedirectResponse
    {
        $response = new RedirectResponse($this->frontendUrl.'/profile?'.http_build_query(['link_error' => $code]));
        $response->headers->setCookie($this->stateCookie('', -1));

        return $response;
    }

    /** @param array<string, string> $extra further query parameters (e.g. the address to confirm) */
    private function fail(string $code, array $extra = []): RedirectResponse
    {
        $response = new RedirectResponse($this->frontendUrl.'/auth/callback?'.http_build_query(['error' => $code] + $extra));
        $response->headers->setCookie($this->stateCookie('', -1));

        return $response;
    }

    /** @return array<string, string> */
    private function authorizeOptions(string $provider, string $state, string $oidcNonce): array
    {
        $options = ['state' => $state, 'nonce' => $oidcNonce];

        // Apple refuses the name/email scopes without form_post; the callback then arrives as a cross-site POST.
        return 'apple' === $provider ? $options + ['response_mode' => 'form_post'] : $options;
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
