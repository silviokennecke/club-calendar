<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Club\InviteMemberDto;
use App\Entity\Club;
use App\Enum\ClubRole;
use App\Security\AuthRateLimiter;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\ClubInvitationService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/** Invitations of a club, managed by its admins. */
#[Route('/api/clubs/{clubId}/invitations')]
#[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
class ClubInvitationController extends AbstractApiController
{
    public function __construct(
        private readonly ClubInvitationService $invitations,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
        private readonly AuthRateLimiter $rateLimiter,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->invitations->listForClub($club));
    }

    /** 204 for every valid address (unknown, registered, already a member, already invited): no enumeration. */
    #[Route('', methods: ['POST'])]
    public function invite(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        try {
            $dto = $this->serializer->deserialize($request->getContent(), InviteMemberDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        $this->rateLimiter->assertInvitationAllowed($user->getId(), $club->getId());
        $this->invitations->invite($club, $user, $dto->email, ClubRole::from($dto->role));

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /** Pending or expired; at most once per minute per invitation. */
    #[Route('/{invitationId}/resend', methods: ['POST'])]
    public function resend(#[MapEntity(id: 'clubId')] Club $club, string $invitationId): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertInvitationResendAllowed($invitationId);
        $this->rateLimiter->assertInvitationAllowed($user->getId(), $club->getId());
        $this->invitations->resend($club, $user, $invitationId);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/{invitationId}', methods: ['DELETE'])]
    public function revoke(#[MapEntity(id: 'clubId')] Club $club, string $invitationId): JsonResponse
    {
        $this->invitations->revoke($club, $invitationId);

        return new JsonResponse(['ok' => true]);
    }
}
