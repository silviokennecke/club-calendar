<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\CalendarMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\CalendarMemberService;
use App\Service\Input;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

/** Per-calendar permissions of club members; club admins only (a calendar member cannot manage them). */
#[Route('/api/calendars/{calendarId}/members')]
#[IsGranted(CalendarMemberVoter::CALENDAR_ADMIN, subject: 'calendar')]
class CalendarMemberController extends AbstractApiController
{
    public function __construct(
        private readonly CalendarMemberService $members,
        private readonly CurrentUserResolver $userResolver,
    ) {
    }

    #[Route('', methods: ['GET'])]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar): JsonResponse
    {
        return new JsonResponse($this->members->list($calendar));
    }

    /** `{userId}` of a club member (any club role). 201 when new, 200 when the permission existed. */
    #[Route('', methods: ['POST'])]
    public function add(#[MapEntity(id: 'calendarId')] Calendar $calendar, Request $request): JsonResponse
    {
        $data = $this->decodeJson($request);
        $result = $this->members->add($calendar, Input::string($data, 'userId', 36), $this->userResolver->resolve());

        return new JsonResponse($result['item'], $result['created'] ? Response::HTTP_CREATED : Response::HTTP_OK);
    }

    #[Route('/{userId}', methods: ['DELETE'])]
    public function remove(#[MapEntity(id: 'calendarId')] Calendar $calendar, string $userId): JsonResponse
    {
        $this->members->remove($calendar, $userId);

        return new JsonResponse(['ok' => true]);
    }
}
