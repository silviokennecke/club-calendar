<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Club;
use App\Security\ClubMemberVoter;
use App\Service\ResourceService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/clubs/{clubId}/resources')]
class ResourceController extends AbstractApiController
{
    public function __construct(
        private readonly ResourceService $resourceService,
    ) {
    }

    #[Route('', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function list(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->resourceService->list($club));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function create(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        return new JsonResponse($this->resourceService->create($club, $this->decodeJson($request)), Response::HTTP_CREATED);
    }

    #[Route('/{id}', methods: ['PATCH'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function update(#[MapEntity(id: 'clubId')] Club $club, string $id, Request $request): JsonResponse
    {
        return new JsonResponse($this->resourceService->update($id, $club, $this->decodeJson($request)));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function delete(#[MapEntity(id: 'clubId')] Club $club, string $id): JsonResponse
    {
        $this->resourceService->delete($id, $club);

        return new JsonResponse(['ok' => true]);
    }
}
