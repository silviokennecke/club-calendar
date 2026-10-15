<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Club\AddMemberDto;
use App\Dto\Club\CreateClubDto;
use App\Entity\Club;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\ClubService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/clubs')]
class ClubController extends AbstractApiController
{
    public function __construct(
        private readonly ClubService $clubService,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(): JsonResponse
    {
        $user = $this->userResolver->resolve();

        return new JsonResponse($this->clubService->listClubs($user));
    }

    #[Route('', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        try {
            $dto = $this->serializer->deserialize($request->getContent(), CreateClubDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);

        return new JsonResponse($this->clubService->createClub($user, $dto->name, $dto->timezone), Response::HTTP_CREATED);
    }

    #[Route('/{clubId}', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function getOne(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->clubService->getClub($club));
    }

    #[Route('/{clubId}', methods: ['PATCH'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function update(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->clubService->updateClub($club, $data));
    }

    #[Route('/{clubId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function delete(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        $this->clubService->deleteClub($club);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{clubId}/members', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function listMembers(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->clubService->listMembers($club));
    }

    #[Route('/{clubId}/members', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function addMember(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), AddMemberDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);

        // 201 for a new member, 200 (same body) when the user already belongs to the club
        $result = $this->clubService->addMember($club, $dto->email);

        return new JsonResponse($result['member'], $result['created'] ? Response::HTTP_CREATED : Response::HTTP_OK);
    }

    #[Route('/{clubId}/members/{userId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function removeMember(#[MapEntity(id: 'clubId')] Club $club, string $userId): JsonResponse
    {
        $this->clubService->removeMember($club, $userId);

        return new JsonResponse(['ok' => true]);
    }
}
