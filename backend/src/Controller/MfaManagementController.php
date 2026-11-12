<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Service\MfaService;
use App\Service\ReauthenticationService;
use App\Service\TokenService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Management of MFA (JWT). Re-authentication = `password`, or for accounts without one
 * `confirmationCode` mailed by `POST /api/auth/mfa/code`: 400 `invalid_credentials` (field `password`) /
 * 400 `invalid_confirmation_code` (field `code`).
 */
#[Route('/api/auth/mfa')]
class MfaManagementController extends AbstractApiController
{
    public function __construct(
        private readonly MfaService $mfa,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly ReauthenticationService $reauth,
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
     * `{setupToken, method, secret?, code?, backupCodes?, backupCodesAcknowledged, password|confirmationCode}`
     * -> `{mfa}`. Other sessions stay.
     */
    #[Route('/enable', methods: ['POST'])]
    public function enable(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $data = $this->decodeJson($request);
        $this->reauthenticate($user, $data);
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

    /** `{password|confirmationCode}` -> `{mfa, ...token response}`: all other sessions end, the new pair continues this one. */
    #[Route('/disable', methods: ['POST'])]
    public function disable(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $consentOk = $this->userResolver->sessionConsentOk();
        $familyExpiresAt = $this->userResolver->sessionFamilyExpiresAt();
        $this->reauthenticate($user, $this->decodeJson($request));
        $this->mfa->disable($user);

        return new JsonResponse(['mfa' => $this->mfa->status($user)] + $this->tokens->tokenResponse($user, null, $familyExpiresAt, $consentOk));
    }

    /** `{password|confirmationCode}` -> `{backupCodes, mfa}`; the new codes are shown once. */
    #[Route('/backup-codes', methods: ['POST'])]
    public function backupCodes(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageAllowed($request, $user->getId());
        $this->reauthenticate($user, $this->decodeJson($request));
        $codes = $this->mfa->regenerateBackupCodes($user);

        return new JsonResponse(['backupCodes' => $codes, 'mfa' => $this->mfa->status($user)]);
    }

    /** 204: a 6-digit code went to the account's address (accounts without password only; 409 `has_password` otherwise). */
    #[Route('/code', methods: ['POST'])]
    public function sendCode(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertMfaManageCodeAllowed($request, $user->getId());
        $this->reauth->sendCode($user, ReauthenticationService::PURPOSE_MFA);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /** @param array<mixed> $data */
    private function reauthenticate(User $user, array $data): void
    {
        foreach (['password', 'confirmationCode'] as $key) {
            if (isset($data[$key]) && !is_string($data[$key])) {
                throw new ApiProblemException(400, 'Invalid request body', 'invalid_request', $key);
            }
        }
        $this->reauth->assertConfirmed($user, ReauthenticationService::PURPOSE_MFA, $data['password'] ?? null, $data['confirmationCode'] ?? null);
    }
}
