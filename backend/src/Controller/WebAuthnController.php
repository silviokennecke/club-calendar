<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Security\StepUp\RequiresStepUp;
use App\Service\WebAuthnService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/auth/webauthn')]
class WebAuthnController extends AbstractController
{
    public function __construct(
        private readonly WebAuthnService $webAuthn,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
    ) {
    }

    /**
     * Registration options. Needs a step-up token (`X-Step-Up-Token`): 403 `step_up_required`. The signed,
     * single-use challenge token it issues is required by `/register/verify`.
     */
    #[Route('/register/options', methods: ['POST'])]
    #[RequiresStepUp]
    public function registrationOptions(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertPasskeyRegisterAllowed($request, $user->getId());

        return new JsonResponse($this->webAuthn->getRegistrationOptions($user));
    }

    #[Route('/register/verify', methods: ['POST'])]
    #[RequiresStepUp]
    public function registrationVerify(Request $request): JsonResponse
    {
        $this->rateLimiter->assertOtherAllowed($request);
        $user = $this->userResolver->resolve();
        $data = $this->ceremonyInput($request);
        $deviceName = $data['deviceName'] ?? null;
        if (null !== $deviceName && (!is_string($deviceName) || mb_strlen($deviceName) > 255)) {
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }
        $id = $this->webAuthn->verifyRegistration($user, $data['challengeToken'], $data['response'], $deviceName);

        return new JsonResponse(['ok' => true, 'id' => $id]);
    }

    #[Route('/authenticate/options', methods: ['GET'])]
    public function authenticationOptions(Request $request): JsonResponse
    {
        $this->rateLimiter->assertOtherAllowed($request);

        return new JsonResponse($this->webAuthn->getAuthenticationOptions());
    }

    #[Route('/authenticate/verify', methods: ['POST'])]
    public function authenticationVerify(Request $request): JsonResponse
    {
        $this->rateLimiter->assertOtherAllowed($request);
        $data = $this->ceremonyInput($request);

        return new JsonResponse($this->webAuthn->verifyAuthentication($data['challengeToken'], $data['response']));
    }

    /**
     * Malformed bodies (no JSON object, missing or mistyped fields) end in a 400, never in a TypeError/500.
     *
     * @return array{challengeToken: string, response: array<mixed>, deviceName?: mixed}
     */
    private function ceremonyInput(Request $request): array
    {
        $data = json_decode($request->getContent(), true);
        if (!is_array($data) || !is_string($data['challengeToken'] ?? null) || !is_array($data['response'] ?? null)) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request');
        }

        return $data;
    }

    /** `{deviceName}` (1-255 chars); the JWT is enough, no re-authentication. */
    #[Route('/{id}', methods: ['PATCH'])]
    public function renamePasskey(string $id, Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = json_decode($request->getContent(), true);
        $name = is_array($data) ? $data['deviceName'] ?? null : null;
        if (!is_string($name) || '' === trim($name) || mb_strlen($name) > 255) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request', 'deviceName');
        }
        $this->webAuthn->renamePasskey($id, $user, trim($name));

        return new JsonResponse(['ok' => true]);
    }

    /**
     * Needs a step-up token (`X-Step-Up-Token`). Ends all sessions and answers with a fresh token pair (a new
     * step-up is needed for the next sensitive action).
     */
    #[Route('/{id}', methods: ['DELETE'])]
    #[RequiresStepUp]
    public function deletePasskey(string $id, Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());

        // `ok` like every delete, plus the fresh token pair: the deletion ended all sessions.
        return new JsonResponse(['ok' => true] + $this->webAuthn->deletePasskey($id, $user, $this->userResolver->sessionConsentOk(), $this->userResolver->sessionFamilyExpiresAt()));
    }
}
