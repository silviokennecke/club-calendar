<?php

declare(strict_types=1);

namespace App\Mcp\Security;

use App\EventListener\ConsentGateListener;
use App\Exception\ApiProblemException;
use App\Http\ProblemResponse;
use App\Mcp\McpContext;
use App\OAuth\OAuthServerService;
use App\Security\AuthRateLimiter;
use App\Security\JwtProblemListener;
use App\Security\SessionConsentListener;
use App\Service\LegalDocumentService;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;
use Symfony\Component\Security\Core\Exception\AuthenticationException;
use Symfony\Component\Security\Core\Exception\CustomUserMessageAuthenticationException;
use Symfony\Component\Security\Http\Authenticator\AbstractAuthenticator;
use Symfony\Component\Security\Http\Authenticator\Passport\Badge\UserBadge;
use Symfony\Component\Security\Http\Authenticator\Passport\Passport;
use Symfony\Component\Security\Http\Authenticator\Passport\SelfValidatingPassport;

/**
 * Firewall `mcp` (`/api/mcp`): stateless Bearer authentication with the opaque MCP access tokens of the OAuth
 * server. Normal JWTs are never valid here and MCP tokens never on the other routes (firewall `api`).
 *
 * Order: per-IP limit, token, per-grant limit, then the account checks the OAuth consent also makes (current
 * consent to the legal documents, confirmed e-mail). A failed login is a 401 with the RFC 9728 pointer to the
 * resource metadata; preflight requests pass unauthenticated.
 */
class McpAuthenticator extends AbstractAuthenticator
{
    public function __construct(
        private readonly OAuthServerService $oauth,
        private readonly AuthRateLimiter $limiter,
        private readonly LegalDocumentService $legal,
        #[Autowire(env: 'BACKEND_URL')]
        private readonly string $backendUrl,
    ) {
    }

    public function supports(Request $request): bool
    {
        return !$request->isMethod(Request::METHOD_OPTIONS);
    }

    public function authenticate(Request $request): Passport
    {
        $this->limiter->assertMcpIpAllowed($request);

        $header = $request->headers->get('Authorization');
        if (null === $header || '' === trim($header)) {
            throw new CustomUserMessageAuthenticationException('Not authenticated', [], 0);
        }
        if (1 !== preg_match('/^Bearer +(\S+)$/i', $header, $m)) {
            throw new CustomUserMessageAuthenticationException('Invalid access token', [], 1);
        }
        $access = $this->oauth->resolveAccessToken($m[1]);
        if (null === $access) {
            throw new CustomUserMessageAuthenticationException('Invalid access token', [], 1);
        }

        $this->limiter->assertMcpGrantAllowed($access->grant->getId());

        $user = $access->user;
        $pending = $this->legal->pendingConsents($user);
        if ([] !== $pending) {
            throw ConsentGateListener::required($pending);
        }
        if (!$user->isEmailVerified()) {
            throw new ApiProblemException(403, 'The e-mail address is not confirmed', 'email_not_verified', null, [], null, ['email' => $user->getEmail()]);
        }

        $request->attributes->set(McpContext::ATTRIBUTE, $access);

        return new SelfValidatingPassport(new UserBadge($user->getUserIdentifier(), static fn () => $user));
    }

    public function createToken(Passport $passport, string $firewallName): TokenInterface
    {
        $token = parent::createToken($passport, $firewallName);
        // Consent was checked strictly above; the generic gate need not repeat its queries.
        $token->setAttribute(SessionConsentListener::ATTRIBUTE, true);

        return $token;
    }

    public function onAuthenticationSuccess(Request $request, TokenInterface $token, string $firewallName): ?Response
    {
        return null;
    }

    public function onAuthenticationFailure(Request $request, AuthenticationException $exception): Response
    {
        $invalid = 1 === $exception->getCode();
        $challenge = sprintf(
            'Bearer %sresource_metadata="%s/.well-known/oauth-protected-resource/api/mcp"',
            $invalid ? 'error="invalid_token", ' : '',
            rtrim($this->backendUrl, '/'),
        );

        return ProblemResponse::create(
            401,
            $invalid ? 'Invalid access token' : 'Not authenticated',
            ['code' => $invalid ? JwtProblemListener::INVALID_TOKEN_CODE : JwtProblemListener::MISSING_TOKEN_CODE],
            ['WWW-Authenticate' => $challenge],
        );
    }
}
