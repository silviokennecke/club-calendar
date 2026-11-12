<?php

declare(strict_types=1);

namespace App\Controller;

use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Service\MfaService;
use App\Service\TokenService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/auth/sessions')]
class SessionController extends AbstractApiController
{
    public function __construct(
        private readonly MfaService $mfa,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly TokenService $tokens,
    ) {
    }

    /**
     * No body -> `{ok: true, ...token response}`: all other sessions and MCP grants end, the new pair of a new
     * family continues this one. No re-authentication (offered right after an MFA sign-in).
     */
    #[Route('/sign-out-others', methods: ['POST'])]
    public function signOutOthers(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $consentOk = $this->userResolver->sessionConsentOk();
        $this->mfa->endOtherSessions($user);

        return new JsonResponse(['ok' => true] + $this->tokens->tokenResponse($user, null, null, $consentOk));
    }
}
