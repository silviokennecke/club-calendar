<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Calendar\CreateCalendarDto;
use App\Entity\Calendar;
use App\Entity\Club;
use App\Security\ClubMemberVoter;
use App\Service\CalendarService;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/clubs/{clubId}/calendars')]
class CalendarController extends AbstractApiController
{
    public function __construct(
        private readonly CalendarService $calendarService,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
    ) {
    }

    #[Route('', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function list(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        $includeArchived = 'true' === $request->query->get('includeArchived');

        return new JsonResponse($this->calendarService->listCalendars($club, $includeArchived));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function create(#[MapEntity(id: 'clubId')] Club $club, Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), CreateCalendarDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);

        return new JsonResponse(
            $this->calendarService->createCalendar($club, $dto->name, $dto->timezone),
            Response::HTTP_CREATED,
        );
    }

    #[Route('/{calendarId}', methods: ['GET'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function getOne(
        #[MapEntity(id: 'clubId')] Club $club,
        #[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')] Calendar $calendar,
    ): JsonResponse {
        return new JsonResponse($this->calendarService->serializeCalendar($calendar));
    }

    #[Route('/{calendarId}', methods: ['PATCH'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function update(
        #[MapEntity(id: 'clubId')] Club $club,
        #[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')] Calendar $calendar,
        Request $request,
    ): JsonResponse {
        $data = $this->decodeJson($request);

        return new JsonResponse($this->calendarService->updateCalendar($calendar, $data));
    }

    #[Route('/{calendarId}', methods: ['DELETE'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function delete(
        #[MapEntity(id: 'clubId')] Club $club,
        #[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')] Calendar $calendar,
    ): JsonResponse {
        $this->calendarService->deleteCalendar($calendar);

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{calendarId}/archive', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function archive(
        #[MapEntity(id: 'clubId')] Club $club,
        #[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')] Calendar $calendar,
    ): JsonResponse {
        return new JsonResponse($this->calendarService->archiveCalendar($calendar));
    }

    #[Route('/{calendarId}/unarchive', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function unarchive(
        #[MapEntity(id: 'clubId')] Club $club,
        #[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')] Calendar $calendar,
    ): JsonResponse {
        return new JsonResponse($this->calendarService->unarchiveCalendar($calendar));
    }

    #[Route('/{calendarId}/duplicate', methods: ['POST'])]
    #[IsGranted(ClubMemberVoter::CLUB_MEMBER, subject: 'club')]
    public function duplicate(
        #[MapEntity(id: 'clubId')] Club $club,
        #[MapEntity(expr: 'repository.findByIdAndClubId(calendarId, clubId)')] Calendar $calendar,
    ): JsonResponse {
        return new JsonResponse($this->calendarService->duplicateCalendar($calendar), Response::HTTP_CREATED);
    }
}
