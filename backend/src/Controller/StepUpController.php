<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Service\MfaLoginService;
use App\Service\StepUpService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Step-up confirmation of sensitive actions (JWT, verified e-mail and consent like any other route). The token it
 * issues goes into the `X-Step-Up-Token` header of the sensitive request. 403 `step_up_unavailable` when the
 * access token has no session claim (refresh it first).
 */
#[Route('/api/auth/step-up')]
class StepUpController extends AbstractApiController
{
    public function __construct(
        private readonly StepUpService $stepUp,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
    ) {
    }

    /** 204: a 6-digit code went to the account's address (accounts without password only; 409 `has_password` otherwise). */
    #[Route('/code', methods: ['POST'])]
    public function sendCode(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertStepUpCodeAllowed($request, $user->getId());
        $this->stepUp->sendCode($user);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /** -> `{options, challengeToken}` (only the user's own passkeys are allowed; 400 `invalid_request` without a passkey). */
    #[Route('/passkey/options', methods: ['POST'])]
    public function passkeyOptions(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertStepUpAllowed($request, $user->getId());

        return new JsonResponse($this->stepUp->passkeyOptions($user));
    }

    /**
     * `{password | confirmationCode, factor?: {method: totp|backup_code, code} | {method: passkey, challengeToken, response}}`
     * -> `{stepUpToken, expiresIn}` (+ `backupCodeUsed: true`, `backupCodesRemaining` after a backup code).
     */
    #[Route('', methods: ['POST'])]
    public function confirm(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertStepUpAllowed($request, $user->getId());
        $data = $this->decodeJson($request);
        foreach (['password', 'confirmationCode'] as $key) {
            if (isset($data[$key]) && !is_string($data[$key])) {
                throw new ApiProblemException(400, 'Invalid request body', 'invalid_request', $key);
            }
        }

        return new JsonResponse($this->stepUp->confirm($user, $data['password'] ?? null, $data['confirmationCode'] ?? null, $this->factor($data['factor'] ?? null)));
    }

    /** @return array{method: string, code?: string, challengeToken?: string, response?: array<mixed>}|null */
    private function factor(mixed $factor): ?array
    {
        if (null === $factor) {
            return null;
        }
        $method = is_array($factor) ? ($factor['method'] ?? null) : null;
        $valid = match ($method) {
            MfaLoginService::METHOD_TOTP, MfaLoginService::METHOD_BACKUP => is_string($factor['code'] ?? null),
            StepUpService::METHOD_PASSKEY => is_string($factor['challengeToken'] ?? null) && is_array($factor['response'] ?? null),
            default => false,
        };
        if (!$valid) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request', 'factor');
        }
        if (StepUpService::METHOD_PASSKEY === $method) {
            return ['method' => $method, 'challengeToken' => $factor['challengeToken'], 'response' => $factor['response']];
        }

        return ['method' => $method, 'code' => mb_strlen($factor['code']) > 64 ? '' : $factor['code']];
    }
}
