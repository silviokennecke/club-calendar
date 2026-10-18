<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Club\InvitationTokenDto;
use App\Security\CurrentUserResolver;
use App\Service\ClubInvitationService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * The signed-in user's own invitations, matched by the VERIFIED e-mail address. Every failure to identify an
 * invitation for this user is the same 404 `invitation_not_found`.
 */
#[Route('/api/invitations')]
class InvitationController extends AbstractApiController
{
    public function __construct(
        private readonly ClubInvitationService $invitations,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(): JsonResponse
    {
        return new JsonResponse($this->invitations->listForUser($this->userResolver->resolve()));
    }

    /** Link from the mail: the SPA sends the token after sign-in. */
    #[Route('/accept', methods: ['POST'])]
    public function acceptByToken(Request $request): JsonResponse
    {
        $token = $this->token($request);

        return new JsonResponse($this->invitations->accept($this->userResolver->resolve(), null, $token));
    }

    #[Route('/decline', methods: ['POST'])]
    public function declineByToken(Request $request): JsonResponse
    {
        $token = $this->token($request);
        $this->invitations->decline($this->userResolver->resolve(), null, $token);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/{invitationId}/accept', methods: ['POST'])]
    public function accept(string $invitationId): JsonResponse
    {
        return new JsonResponse($this->invitations->accept($this->userResolver->resolve(), $invitationId, null));
    }

    #[Route('/{invitationId}/decline', methods: ['POST'])]
    public function decline(string $invitationId): JsonResponse
    {
        $this->invitations->decline($this->userResolver->resolve(), $invitationId, null);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    private function token(Request $request): string
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), InvitationTokenDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);

        return $dto->token;
    }
}
