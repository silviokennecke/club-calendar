<?php

declare(strict_types=1);

namespace App\Controller;

use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Security\StepUp\RequiresStepUp;
use App\Service\MfaService;
use App\Service\TokenService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/** Management of MFA (JWT). Enable, disable and backup codes need a step-up token (`X-Step-Up-Token`): 403 `step_up_required`. */
#[Route('/api/auth/mfa')]
class MfaManagementController extends AbstractApiController
{
    public function __construct(
        private readonly MfaService $mfa,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly TokenService $tokens,
    ) {
    }

    /** `{method: totp|passkeys}` -> `{setupToken, backupCodes: [..]|null, secret?, otpauthUri?}`; stores nothing. */
    #[Route('/setup', methods: ['POST'])]
    public function setup(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertOtherAllowed($request);
        $data = $this->decodeJson($request);
        if (!is_string($data['method'] ?? null)) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request', 'method');
        }

        return new JsonResponse($this->mfa->setup($user, $data['method']));
    }

    /**
     * `{setupToken, method, secret?, code?, backupCodes?, backupCodesAcknowledged}` -> `{mfa}`. Other sessions stay.
     */
    #[Route('/enable', methods: ['POST'])]
    #[RequiresStepUp]
    public function enable(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $data = $this->decodeJson($request);
        $codes = $data['backupCodes'] ?? null;
        foreach (['secret', 'code'] as $key) {
            if (isset($data[$key]) && !is_string($data[$key])) {
                throw new ApiProblemException(400, 'Invalid request body', 'invalid_request', $key);
            }
        }
        if (!is_string($data['setupToken'] ?? null) || !is_string($data['method'] ?? null)
            || (null !== $codes && (!is_array($codes) || !array_is_list($codes) || count($codes) > 50 || array_filter($codes, is_string(...)) !== $codes))) {
            throw new ApiProblemException(400, 'Invalid request body', 'invalid_request');
        }

        return new JsonResponse(['mfa' => $this->mfa->enable(
            $user,
            $data['setupToken'],
            $data['method'],
            $data['secret'] ?? null,
            $data['code'] ?? null,
            $codes,
            true === ($data['backupCodesAcknowledged'] ?? false),
        )]);
    }

    /** -> `{mfa, ...token response}`: all other sessions end, the new pair continues this one (it needs a new step-up). */
    #[Route('/disable', methods: ['POST'])]
    #[RequiresStepUp]
    public function disable(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $consentOk = $this->userResolver->sessionConsentOk();
        $familyExpiresAt = $this->userResolver->sessionFamilyExpiresAt();
        $this->mfa->disable($user);

        return new JsonResponse(['mfa' => $this->mfa->status($user)] + $this->tokens->tokenResponse($user, null, $familyExpiresAt, $consentOk));
    }

    /** -> `{backupCodes, mfa}`; the new codes are shown once. */
    #[Route('/backup-codes', methods: ['POST'])]
    #[RequiresStepUp]
    public function backupCodes(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $codes = $this->mfa->regenerateBackupCodes($user);

        return new JsonResponse(['backupCodes' => $codes, 'mfa' => $this->mfa->status($user)]);
    }
}
