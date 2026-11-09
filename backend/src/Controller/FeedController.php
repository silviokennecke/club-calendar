<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Club;
use App\Entity\FeedMember;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\EventService;
use App\Service\FeedMemberService;
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
        private readonly FeedMemberService $feedMembers,
        private readonly CurrentUserResolver $userResolver,
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
        // Optional body {revokeClaimed: bool}: an empty body is fine
        $data = '' === trim($request->getContent()) ? [] : $this->decodeJson($request);
        $revoke = array_key_exists('revokeClaimed', $data) ? Input::bool($data, 'revokeClaimed') : false;

        return new JsonResponse($this->feedService->regenerateSecret($feedId, $club, $this->includeSecret($request), $revoke));
    }

    #[Route('/{feedId}/members', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function listMembers(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        $query = $request->query->all();
        foreach (['page', 'perPage', 'q', 'source'] as $key) {
            if (isset($query[$key]) && !is_string($query[$key])) {
                throw Input::invalid($key, sprintf('%s must be a single value', $key));
            }
        }
        $page = Input::optionalInt($query['page'] ?? null, 'page', 1, 1000000) ?? 1;
        $perPage = Input::optionalInt($query['perPage'] ?? null, 'perPage', 1, FeedMemberService::MAX_PER_PAGE) ?? FeedMemberService::DEFAULT_PER_PAGE;
        $q = trim((string) ($query['q'] ?? ''));
        if (mb_strlen($q) > EventService::SEARCH_MAX_LENGTH) {
            throw Input::invalid('q', sprintf('q must be at most %d characters', EventService::SEARCH_MAX_LENGTH));
        }
        $source = $query['source'] ?? '';
        if ('' !== $source && !in_array($source, [FeedMember::ASSIGNED, FeedMember::CLAIMED], true)) {
            throw Input::invalid('source', 'source must be assigned or claimed');
        }

        $result = $this->feedMembers->list($club, $feedId, $page, $perPage, '' === $q ? null : $q, '' === $source ? null : $source);

        return new JsonResponse($result['items'], 200, ['X-Total-Count' => (string) $result['total']]);
    }

    #[Route('/{feedId}/members', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function addMembers(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        $ids = Input::idList($this->decodeJson($request), 'userIds');

        return new JsonResponse(['added' => $this->feedMembers->assign($club, $feedId, $ids, $this->userResolver->resolve())]);
    }

    #[Route('/{feedId}/members/by-email', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function addMembersByEmail(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        $emails = Input::idList($this->decodeJson($request), 'emails');

        return new JsonResponse($this->feedMembers->assignByEmail($club, $feedId, $emails, $this->userResolver->resolve()));
    }

    #[Route('/{feedId}/members/bulk-delete', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function bulkRemoveMembers(#[MapEntity(id: 'clubId')] Club $club, string $feedId, Request $request): JsonResponse
    {
        $ids = Input::idList($this->decodeJson($request), 'userIds');

        return new JsonResponse(['removed' => $this->feedMembers->removeMany($club, $feedId, $ids)]);
    }

    #[Route('/{feedId}/members/{userId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_EDITOR, subject: 'club')]
    public function removeMember(#[MapEntity(id: 'clubId')] Club $club, string $feedId, string $userId): JsonResponse
    {
        $this->feedMembers->remove($club, $feedId, $userId);

        return new JsonResponse(['ok' => true]);
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
