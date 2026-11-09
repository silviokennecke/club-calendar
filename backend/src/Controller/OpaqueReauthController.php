<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\OpaqueReauthFinishDto;
use App\Dto\Auth\OpaqueReauthStartDto;
use App\Exception\ApiProblemException;
use App\Opaque\AuthenticationFailedException;
use App\Opaque\Base64Url;
use App\Opaque\InvalidMessageException;
use App\Opaque\Ke1;
use App\Opaque\OpaqueReauthTickets;
use App\Opaque\OpaqueService;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * OPAQUE re-authentication of the signed-in user (docs/ops/OPAQUE-PLAN.md 3.2/3.4): proves the password for one
 * purpose and returns a single-use `reauthTicket` that the consuming route redeems. The credential id is the JWT user,
 * never a client field.
 */
#[Route('/api/auth/opaque/reauth')]
class OpaqueReauthController extends AbstractApiController
{
    private const int KE3_LENGTH = 64;

    public function __construct(
        private readonly OpaqueService $opaque,
        private readonly OpaqueReauthTickets $tickets,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
    ) {
    }

    /**
     * Every start is a password guess for the client: it counts against the user's and the IP's login limits and the
     * purpose's own attempt limit, all before any crypto. An account without a record gets 409 `opaque_not_registered`
     * (the signed-in user knows their own state; legacy accounts keep using the password).
     */
    #[Route('/start', methods: ['POST'])]
    public function start(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, OpaqueReauthStartDto::class);
        $this->validateDto($dto, $this->validator);
        $this->assertPurpose($dto->purpose);
        $user = $this->userResolver->resolve();

        $this->rateLimiter->assertLoginAllowed($request, $user->getEmail());
        match ($dto->purpose) {
            OpaqueReauthTickets::PURPOSE_DELETE_ACCOUNT => $this->rateLimiter->assertAccountDeleteAllowed($request, $user->getId()),
            OpaqueReauthTickets::PURPOSE_PASSKEY_REGISTER => $this->rateLimiter->assertPasskeyRegisterAllowed($request, $user->getId()),
            default => null,
        };
        $ke1 = $this->decode($dto->startLoginRequest, 'startLoginRequest', Ke1::LENGTH);
        if (!$this->opaque->hasRecord($user)) {
            throw new ApiProblemException(409, 'This account has no OPAQUE password record', 'opaque_not_registered');
        }

        try {
            $challenge = $this->opaque->startReauth($user, $dto->purpose, $ke1);
        } catch (InvalidMessageException $e) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', 'startLoginRequest', [], $e);
        }

        return new JsonResponse([
            'loginResponse' => Base64Url::encode($challenge->ke2),
            'loginState' => $challenge->loginState,
            'ksfProfile' => $challenge->ksfProfile,
        ]);
    }

    /** After the format checks every failure is the same 400 `invalid_credentials` (field `password`), like a wrong password today. */
    #[Route('/finish', methods: ['POST'])]
    public function finish(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, OpaqueReauthFinishDto::class);
        $this->validateDto($dto, $this->validator);
        $this->assertPurpose($dto->purpose);
        $user = $this->userResolver->resolve();
        $ke3 = $this->decode($dto->finishLoginRequest, 'finishLoginRequest', self::KE3_LENGTH);

        try {
            $ticket = $this->opaque->finishReauth($user, $dto->purpose, $dto->loginState, $ke3);
        } catch (InvalidMessageException|AuthenticationFailedException $e) {
            throw new ApiProblemException(400, 'The password is not correct', 'invalid_credentials', 'password', [], $e);
        }

        return new JsonResponse(['reauthTicket' => $ticket, 'expiresIn' => OpaqueReauthTickets::TTL]);
    }

    private function assertPurpose(string $purpose): void
    {
        if (!in_array($purpose, OpaqueReauthTickets::PURPOSES, true)) {
            throw new ApiProblemException(400, 'Unknown reauth purpose', 'invalid_request', 'purpose');
        }
    }

    private function decode(string $value, string $field, int $length): string
    {
        $bytes = Base64Url::decode($value);
        if (null === $bytes || $length !== strlen($bytes)) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', $field);
        }

        return $bytes;
    }

    private function deserializeDto(Request $request, string $class): object
    {
        try {
            return $this->serializer->deserialize($request->getContent(), $class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body', $e);
        }
    }
}
