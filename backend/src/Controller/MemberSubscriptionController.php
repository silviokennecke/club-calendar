<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Club;
use App\Security\AuthRateLimiter;
use App\Security\ClubMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\Input;
use App\Service\MemberSubscriptionService;
use App\Service\PersonalFeedService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/** The signed-in member's own personal subscription ("Mein Abo"); open to every role incl. plain `member`. */
#[Route('/api/clubs/{clubId}')]
#[IsGranted(ClubMemberVoter::CLUB_ANY_MEMBER, subject: 'club')]
class MemberSubscriptionController extends AbstractApiController
{
    public function __construct(
        private readonly MemberSubscriptionService $subscriptions,
        private readonly PersonalFeedService $personal,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
    ) {
    }

    #[Route('/my-subscription', methods: ['GET'])]
    public function get(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->subscriptions->get($this->userResolver->resolve(), $club));
    }

    #[Route('/my-subscription', methods: ['PUT'])]
    public function replace(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        return new JsonResponse($this->subscriptions->replace($this->userResolver->resolve(), $club, $this->decodeJson($request)));
    }

    #[Route('/my-subscription/rotate-secret', methods: ['POST'])]
    public function rotateSecret(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertSubscriptionRotateAllowed($user->getId());

        return new JsonResponse($this->subscriptions->rotateSecret($user, $club));
    }

    #[Route('/my-feeds', methods: ['GET'])]
    public function feeds(#[MapEntity(id: 'clubId')] Club $club): JsonResponse
    {
        return new JsonResponse($this->subscriptions->options($this->userResolver->resolve(), $club));
    }

    /** Calendar view of the member's effective feeds; `targetGroupIds[]` overrides the subscription's selection (empty = all). */
    #[Route('/my-events', methods: ['GET'])]
    public function events(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $selection = $this->personal->forMember($this->userResolver->resolve(), $club);
        $query = $request->query->all();

        return new JsonResponse($this->personal->getEvents(
            $selection,
            array_key_exists('targetGroupIds', $query) ? $this->groupIds($query['targetGroupIds']) : null,
            $query['from'] ?? null,
            $query['to'] ?? null,
        ));
    }

    #[Route('/my-events/{eventId}', methods: ['GET'])]
    public function event(#[MapEntity(id: 'clubId')] Club $club, string $eventId): JsonResponse
    {
        return new JsonResponse($this->personal->getEvent($this->personal->forMember($this->userResolver->resolve(), $club), $eventId));
    }

    /** @return list<string> */
    private function groupIds(mixed $value): array
    {
        $parts = is_array($value) ? $value : [$value];
        $ids = [];
        foreach ($parts as $part) {
            if (!is_string($part)) {
                throw Input::invalid('targetGroupIds', 'targetGroupIds must be strings');
            }
            foreach (explode(',', $part) as $id) {
                if ('' !== trim($id)) {
                    $ids[trim($id)] = true;
                }
            }
        }

        return array_map('strval', array_keys($ids));
    }
}
