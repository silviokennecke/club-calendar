<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Club\CreateClubDto;
use App\Entity\Club;
use App\Enum\ClubRole;
use App\Exception\ApiProblemException;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\ClubService;
use App\Service\EventService;
use App\Service\Input;
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
    #[IsGranted(ClubMemberVoter::CLUB_ANY_MEMBER, subject: 'club')]
    public function getOne(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->clubService->getClub($club, $this->userResolver->resolve()));
    }

    #[Route('/{clubId}', methods: ['PATCH'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function update(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->clubService->updateClub($club, $data));
    }

    #[Route('/{clubId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function delete(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        $this->clubService->deleteClub($club);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{clubId}/members', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function listMembers(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $query = $request->query->all();
        foreach (['page', 'perPage', 'q', 'role'] as $key) {
            if (isset($query[$key]) && !is_string($query[$key])) {
                throw Input::invalid($key, sprintf('%s must be a single value', $key));
            }
        }
        $page = Input::optionalInt($query['page'] ?? null, 'page', 1, 1000000) ?? 1;
        $perPage = Input::optionalInt($query['perPage'] ?? null, 'perPage', 1, ClubService::MEMBERS_MAX_PER_PAGE) ?? ClubService::MEMBERS_DEFAULT_PER_PAGE;
        $q = trim((string) ($query['q'] ?? ''));
        if (mb_strlen($q) > EventService::SEARCH_MAX_LENGTH) {
            throw Input::invalid('q', sprintf('q must be at most %d characters', EventService::SEARCH_MAX_LENGTH));
        }
        $roleValue = $query['role'] ?? '';
        $role = '' === $roleValue ? null : ClubRole::tryFrom($roleValue);
        if ('' !== $roleValue && null === $role) {
            throw Input::invalid('role', 'role must be one of '.implode(', ', ClubRole::values()));
        }

        $result = $this->clubService->listMembers($club, $page, $perPage, '' === $q ? null : $q, $role);

        return new JsonResponse($result['items'], 200, ['X-Total-Count' => (string) $result['total']]);
    }

    #[Route('/{clubId}/members/{userId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_ANY_MEMBER, subject: 'club')]
    public function removeMember(#[MapEntity(id: 'clubId')] Club $club, string $userId): JsonResponse
    {
        $this->clubService->removeMember($club, $userId, $this->userResolver->resolve());

        return new JsonResponse(['ok' => true]);
    }

    /** Admins only (the service re-checks under the club lock): `{role: member|viewer|editor|admin}`. */
    #[Route('/{clubId}/members/{userId}', methods: ['PATCH'])]
    #[IsGranted(ClubMemberVoter::CLUB_ADMIN, subject: 'club')]
    public function changeRole(#[MapEntity(id: 'clubId')] Club $club, string $userId, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        $role = ClubRole::tryFrom((string) ($data['role'] ?? ''));
        if (null === $role) {
            throw new ApiProblemException(422, 'role must be one of '.implode(', ', ClubRole::values()), ClubService::INVALID_ROLE_CODE, 'role');
        }

        return new JsonResponse($this->clubService->changeRole($club, $userId, $role, $this->userResolver->resolve()));
    }
}
