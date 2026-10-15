<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
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

    #[Route('/register/options', methods: ['GET'])]
    public function registrationOptions(Request $request): JsonResponse
    {
        $this->rateLimiter->assertOtherAllowed($request);
        $user = $this->userResolver->resolve();

        return new JsonResponse($this->webAuthn->getRegistrationOptions($user));
    }

    #[Route('/register/verify', methods: ['POST'])]
    public function registrationVerify(Request $request): JsonResponse
    {
        $this->rateLimiter->assertOtherAllowed($request);
        $user = $this->userResolver->resolve();
        $data = $this->ceremonyInput($request);
        $deviceName = $data['deviceName'] ?? null;
        if (null !== $deviceName && (!is_string($deviceName) || mb_strlen($deviceName) > 255)) {
            throw new ApiProblemException(400, 'Invalid passkey registration', 'invalid_passkey_registration');
        }
        $this->webAuthn->verifyRegistration($user, $data['challengeToken'], $data['response'], $deviceName);

        return new JsonResponse(['ok' => true]);
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

    #[Route('/{id}', methods: ['DELETE'])]
    public function deletePasskey(string $id): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->webAuthn->deletePasskey($id, $user);

        return new JsonResponse(['ok' => true]);
    }
}
