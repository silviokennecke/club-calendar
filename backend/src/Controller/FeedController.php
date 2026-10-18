<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Club;
use App\Security\ClubMemberVoter;
use App\Service\FeedService;
use App\Service\Input;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/clubs/{clubId}/feeds')]
class FeedController extends AbstractApiController
{
    public function __construct(
        private readonly FeedService $feedService,
    ) {
    }

    #[Route('', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function list(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        return new JsonResponse($this->feedService->list($club, $this->includeSecret($request)));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function create(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->feedService->create($club, $data, $this->includeSecret($request)), Response::HTTP_CREATED);
    }

    #[Route('/{feedId}', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function getOne(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        return new JsonResponse($this->feedService->get($feedId, $club, $this->includeSecret($request)));
    }

    #[Route('/{feedId}', methods: ['PATCH'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function update(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->feedService->update($feedId, $club, $data, $this->includeSecret($request)));
    }

    #[Route('/{feedId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function delete(#[MapEntity(id: 'clubId')] Club $club, string $feedId): JsonResponse
    {
        $this->feedService->delete($feedId, $club);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{feedId}/regenerate-secret', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function regenerateSecret(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        return new JsonResponse($this->feedService->regenerateSecret($feedId, $club, $this->includeSecret($request)));
    }

    /** `?includeSecret=1|true` returns the shared secret; absent, `0` or `false` omits it, anything else is 400. */
    private function includeSecret(Request $request): bool
    {
        return match ($request->query->all()['includeSecret'] ?? null) {
            null, '', '0', 'false' => false,
            '1', 'true' => true,
            default => throw Input::invalid('includeSecret', 'includeSecret must be true or false'),
        };
    }
}
