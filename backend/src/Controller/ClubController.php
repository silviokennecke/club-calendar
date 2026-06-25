<?php
declare(strict_types=1);

namespace App\Controller;

use App\Dto\Club\AddMemberDto;
use App\Dto\Club\CreateClubDto;
use App\Entity\Club;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\ClubService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/clubs')]
class ClubController extends AbstractApiController
{
    public function __construct(
        private readonly ClubService $clubService,
        private readonly CurrentUserResolver $userResolver,
        private readonly EntityManagerInterface $em,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
    ) {}

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
            throw new BadRequestHttpException('Invalid JSON body: ' . $e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        return new JsonResponse($this->clubService->createClub($user, $dto->name, $dto->timezone), Response::HTTP_CREATED);
    }

    #[Route('/{clubId}', methods: ['GET'])]
    public function getOne(int $clubId): JsonResponse
    {
        $club = $this->findClub($clubId);
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        return new JsonResponse($this->clubService->getClub($club));
    }

    #[Route('/{clubId}', methods: ['PATCH'])]
    public function update(int $clubId, Request $request): JsonResponse
    {
        $club = $this->findClub($clubId);
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        $data = $this->decodeJson($request);
        return new JsonResponse($this->clubService->updateClub($club, $data));
    }

    #[Route('/{clubId}', methods: ['DELETE'])]
    public function delete(int $clubId): JsonResponse
    {
        $club = $this->findClub($clubId);
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        $this->clubService->deleteClub($club);
        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{clubId}/members', methods: ['GET'])]
    public function listMembers(int $clubId): JsonResponse
    {
        $club = $this->findClub($clubId);
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        return new JsonResponse($this->clubService->listMembers($club));
    }

    #[Route('/{clubId}/members', methods: ['POST'])]
    public function addMember(int $clubId, Request $request): JsonResponse
    {
        $club = $this->findClub($clubId);
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        try {
            $dto = $this->serializer->deserialize($request->getContent(), AddMemberDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: ' . $e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        return new JsonResponse($this->clubService->addMember($club, $dto->email), Response::HTTP_CREATED);
    }

    #[Route('/{clubId}/members/{userId}', methods: ['DELETE'])]
    public function removeMember(int $clubId, int $userId): JsonResponse
    {
        $club = $this->findClub($clubId);
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        $this->clubService->removeMember($club, $userId);
        return new JsonResponse(['ok' => true]);
    }

    private function findClub(int $clubId): Club
    {
        $club = $this->em->getRepository(Club::class)->find($clubId);
        if (!$club) {
            throw new NotFoundHttpException('Club not found');
        }
        return $club;
    }
}
