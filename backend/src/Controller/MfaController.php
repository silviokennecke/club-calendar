<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Service\MfaLoginService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/**
 * MFA of the password sign-in. Public routes: the signed `mfaToken` from `POST /api/auth/login`
 * is the credential. 401 `invalid_mfa_token`, 401 `invalid_mfa_code` (field `code`, same for TOTP and backup
 * code), 401 `invalid_passkey`, 429 `rate_limited`.
 */
#[Route('/api/auth/mfa')]
class MfaController extends AbstractApiController
{
    public function __construct(
        private readonly MfaLoginService $login,
        private readonly AuthRateLimiter $rateLimiter,
    ) {
    }

    /** `{mfaToken, method: totp|backup_code, code}` -> the token response of a login (+ `backupCodeUsed: true` and `backupCodesRemaining` after a backup code; MFA stays on). */
    #[Route('/verify', methods: ['POST'])]
    public function verify(Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        $method = $data['method'] ?? null;
        if (!is_string($data['mfaToken'] ?? null) || !in_array($method, [MfaLoginService::METHOD_TOTP, MfaLoginService::METHOD_BACKUP], true)
            || !is_string($data['code'] ?? null)) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request');
        }
        $claims = $this->login->claims($data['mfaToken']);
        $this->rateLimiter->assertMfaVerifyAllowed($request, $claims['sub'], $claims['jti']);

        return $this->finished($this->login->verifyCode($claims, $method, mb_strlen($data['code']) > 64 ? '' : $data['code']));
    }

    /** `{mfaToken}` -> `{options, challengeToken}` (only the user's own passkeys are allowed). */
    #[Route('/passkey/options', methods: ['POST'])]
    public function passkeyOptions(Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        if (!is_string($data['mfaToken'] ?? null)) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request');
        }
        $this->rateLimiter->assertOtherAllowed($request);

        return new JsonResponse($this->login->passkeyOptions($this->login->claims($data['mfaToken'])));
    }

    /** `{mfaToken, challengeToken, response}` -> the token response of a login. */
    #[Route('/passkey/verify', methods: ['POST'])]
    public function passkeyVerify(Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        if (!is_string($data['mfaToken'] ?? null) || !is_string($data['challengeToken'] ?? null) || !is_array($data['response'] ?? null)) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request');
        }
        $claims = $this->login->claims($data['mfaToken']);
        $this->rateLimiter->assertMfaVerifyAllowed($request, $claims['sub'], $claims['jti']);

        return $this->finished($this->login->verifyPasskey($claims, $data['challengeToken'], $data['response']));
    }

    /** @param array{user: array{email: string}} $tokens */
    private function finished(array $tokens): JsonResponse
    {
        $this->rateLimiter->recordLoginSuccess($tokens['user']['email']);

        return new JsonResponse($tokens);
    }
}
