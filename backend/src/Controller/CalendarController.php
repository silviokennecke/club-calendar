<?php
declare(strict_types=1);

namespace App\Controller;

use App\Dto\Calendar\CreateCalendarDto;
use App\Entity\Club;
use App\Security\ClubMemberVoter;
use App\Service\CalendarService;
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

#[Route('/api/clubs/{clubId}/calendars')]
class CalendarController extends AbstractApiController
{
    public function __construct(
        private readonly CalendarService $calendarService,
        private readonly EntityManagerInterface $em,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
    ) {}

    #[Route('', methods: ['GET'])]
    public function list(int $clubId, Request $request): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $includeArchived = $request->query->get('includeArchived') === 'true';
        return new JsonResponse($this->calendarService->listCalendars($club, $includeArchived));
    }

    #[Route('', methods: ['POST'])]
    public function create(int $clubId, Request $request): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        try {
            $dto = $this->serializer->deserialize($request->getContent(), CreateCalendarDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: ' . $e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        return new JsonResponse(
            $this->calendarService->createCalendar($club, $dto->name, $dto->timezone),
            Response::HTTP_CREATED
        );
    }

    #[Route('/{calendarId}', methods: ['GET'])]
    public function getOne(int $clubId, int $calendarId): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $cal  = $this->calendarService->verifyCalendarBelongsToClub($calendarId, $club);
        return new JsonResponse($this->calendarService->serializeCalendar($cal));
    }

    #[Route('/{calendarId}', methods: ['PATCH'])]
    public function update(int $clubId, int $calendarId, Request $request): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $cal  = $this->calendarService->verifyCalendarBelongsToClub($calendarId, $club);
        $data = $this->decodeJson($request);
        return new JsonResponse($this->calendarService->updateCalendar($cal, $data));
    }

    #[Route('/{calendarId}', methods: ['DELETE'])]
    public function delete(int $clubId, int $calendarId): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $cal  = $this->calendarService->verifyCalendarBelongsToClub($calendarId, $club);
        $this->calendarService->deleteCalendar($cal);
        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{calendarId}/archive', methods: ['POST'])]
    public function archive(int $clubId, int $calendarId): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $cal  = $this->calendarService->verifyCalendarBelongsToClub($calendarId, $club);
        return new JsonResponse($this->calendarService->archiveCalendar($cal));
    }

    #[Route('/{calendarId}/unarchive', methods: ['POST'])]
    public function unarchive(int $clubId, int $calendarId): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $cal  = $this->calendarService->verifyCalendarBelongsToClub($calendarId, $club);
        return new JsonResponse($this->calendarService->unarchiveCalendar($cal));
    }

    #[Route('/{calendarId}/duplicate', methods: ['POST'])]
    public function duplicate(int $clubId, int $calendarId): JsonResponse
    {
        $club = $this->findAndAuthorizeClub($clubId);
        $cal  = $this->calendarService->verifyCalendarBelongsToClub($calendarId, $club);
        return new JsonResponse($this->calendarService->duplicateCalendar($cal), Response::HTTP_CREATED);
    }

    private function findAndAuthorizeClub(int $clubId): Club
    {
        $club = $this->em->getRepository(Club::class)->find($clubId);
        if (!$club) {
            throw new NotFoundHttpException('Club not found');
        }
        $this->denyAccessUnlessGranted(ClubMemberVoter::CLUB_MEMBER, $club);
        return $club;
    }
}
