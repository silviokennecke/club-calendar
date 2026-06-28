<?php

declare(strict_types=1);

namespace App\Controller;

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
    ) {
    }

    #[Route('/register/options', methods: ['GET'])]
    public function registrationOptions(): JsonResponse
    {
        $user = $this->userResolver->resolve();

        return new JsonResponse($this->webAuthn->getRegistrationOptions($user));
    }

    #[Route('/register/verify', methods: ['POST'])]
    public function registrationVerify(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = json_decode($request->getContent(), true) ?? [];
        $this->webAuthn->verifyRegistration(
            $user,
            $data['challengeToken'] ?? '',
            $data['response'] ?? [],
            $data['deviceName'] ?? null,
        );

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/authenticate/options', methods: ['GET'])]
    public function authenticationOptions(): JsonResponse
    {
        return new JsonResponse($this->webAuthn->getAuthenticationOptions());
    }

    #[Route('/authenticate/verify', methods: ['POST'])]
    public function authenticationVerify(Request $request): JsonResponse
    {
        $data = json_decode($request->getContent(), true) ?? [];

        return new JsonResponse(
            $this->webAuthn->verifyAuthentication(
                $data['challengeToken'] ?? '',
                $data['response'] ?? [],
            ),
        );
    }

    #[Route('/{id}', methods: ['DELETE'])]
    public function deletePasskey(string $id): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->webAuthn->deletePasskey($id, $user);

        return new JsonResponse(['ok' => true]);
    }
}
