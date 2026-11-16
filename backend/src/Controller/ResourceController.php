<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Club;
use App\Enum\ClubRole;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\ResourceCalendarService;
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
        private readonly ResourceCalendarService $calendarService,
        private readonly CurrentUserResolver $userResolver,
    ) {
    }

    /**
     * Viewer+ get the full list; a plain member (allowed by CLUB_ANY_MEMBER, role re-checked here) only gets
     * the `members` resources with minimal fields.
     */
    #[Route('', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_ANY_MEMBER, subject: 'club')]
    public function list(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        $role = $this->calendarService->role($club, $this->userResolver->resolve());
        if (null === $role || !$role->atLeast(ClubRole::VIEWER)) {
            return new JsonResponse($this->resourceService->listForMember($club));
        }

        return new JsonResponse($this->resourceService->list($club));
    }

    /** Events at the resource's location (all calendars); `from`, `to` required. Busy-only items for plain members. */
    #[Route('/{id}/events', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_ANY_MEMBER, subject: 'club')]
    public function events(#[MapEntity(id: 'clubId')] Club $club, string $id, Request $request): JsonResponse
    {
        $page = $this->calendarService->events($club, $id, $this->userResolver->resolve(), $request->query->all());

        return new JsonResponse($page['items'], 200, ['X-Total-Count' => (string) $page['total']]);
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
