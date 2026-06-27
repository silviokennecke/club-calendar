<?php
declare(strict_types=1);

namespace App\Controller;

use App\Dto\Holiday\CreateHolidayCalendarDto;
use App\Dto\Holiday\UpdateHolidayCalendarDto;
use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Repository\HolidayCalendarRepository;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\HolidayCalendarService;
use DateTimeInterface;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/calendars/{calendarId}/holiday-calendars')]
class HolidayCalendarController extends AbstractApiController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly HolidayCalendarRepository $holidayCalendarRepo,
        private readonly HolidayCalendarService $holidayCalendarService,
    ) {}

    #[Route('', methods: ['GET'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    public function list(#[MapEntity(id: 'calendarId')] Calendar $calendar): JsonResponse
    {
        $items = $this->holidayCalendarRepo->findByCalendarId($calendar->getId());

        return new JsonResponse(array_map($this->serialize(...), $items));
    }

    #[Route('', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function create(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
        ValidatorInterface $validator,
    ): JsonResponse {
        $data = $this->decodeJson($request);
        $dto = new CreateHolidayCalendarDto();
        $dto->name = (string) ($data['name'] ?? '');
        $dto->url = (string) ($data['url'] ?? '');
        $this->validateDto($dto, $validator);

        $hc = new HolidayCalendar($calendar, $dto->name, $dto->url);
        try {
            $this->em->wrapInTransaction(function () use ($hc): void {
                $this->em->persist($hc);
                $this->em->flush();
                $this->holidayCalendarService->fetchAndStore($hc);
            });
        } catch (Throwable) {
            return new JsonResponse(['error' => 'Failed to fetch ICS feed. Please check the URL and try again.'], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return new JsonResponse($this->serialize($hc), Response::HTTP_CREATED);
    }

    #[Route('/{hcId}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function update(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        string $hcId,
        Request $request,
        ValidatorInterface $validator,
    ): JsonResponse {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            return new JsonResponse(['error' => 'Not found'], Response::HTTP_NOT_FOUND);
        }

        $data = $this->decodeJson($request);
        $dto = new UpdateHolidayCalendarDto();
        $dto->name = (string) ($data['name'] ?? '');
        $dto->url = (string) ($data['url'] ?? '');
        $this->validateDto($dto, $validator);

        $hc->setName($dto->name);
        $hc->setUrl($dto->url);
        $this->em->flush();

        return new JsonResponse($this->serialize($hc));
    }

    #[Route('/{hcId}', methods: ['DELETE'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function delete(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        string $hcId,
    ): JsonResponse {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            return new JsonResponse(['error' => 'Not found'], Response::HTTP_NOT_FOUND);
        }

        $this->em->remove($hc);
        $this->em->flush();

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/{hcId}/refresh', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function refresh(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        string $hcId,
    ): JsonResponse {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            return new JsonResponse(['error' => 'Not found'], Response::HTTP_NOT_FOUND);
        }

        try {
            $this->holidayCalendarService->fetchAndStore($hc);
        } catch (Throwable) {
            return new JsonResponse(['error' => 'Failed to fetch ICS feed. Please check the URL and try again.'], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        return new JsonResponse($this->serialize($hc));
    }

    private function serialize(HolidayCalendar $hc): array
    {
        return [
            'id'            => $hc->getId(),
            'name'          => $hc->getName(),
            'url'           => $hc->getUrl(),
            'lastFetchedAt' => $hc->getLastFetchedAt()?->format(DateTimeInterface::ATOM),
            'eventCount'    => $hc->getEvents()->count(),
        ];
    }
}
