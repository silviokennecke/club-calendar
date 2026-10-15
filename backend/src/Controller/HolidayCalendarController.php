<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Holiday\CreateHolidayCalendarDto;
use App\Dto\Holiday\UpdateHolidayCalendarDto;
use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Exception\ApiProblemException;
use App\Repository\HolidayCalendarRepository;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\HolidayCalendarService;
use App\Service\Input;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Doctrine\Attribute\MapEntity;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
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
    ) {
    }

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
        $dto->name = self::stringValue($data, 'name') ?? '';
        $dto->url = self::stringValue($data, 'url') ?? '';
        $this->validateDto($dto, $validator);

        $hc = new HolidayCalendar($calendar, $dto->name, $dto->url);
        try {
            // The stored holidays are not in $hc->getEvents() (new entity, collection not reloaded):
            // the response carries the number fetchAndStore() stored.
            $eventCount = $this->em->wrapInTransaction(function () use ($hc): int {
                $this->em->persist($hc);
                $this->em->flush();

                return $this->holidayCalendarService->fetchAndStore($hc);
            });
        } catch (\Throwable) {
            throw self::fetchFailed();
        }

        return new JsonResponse($this->serialize($hc, $eventCount), Response::HTTP_CREATED);
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
        $hc = $this->find($calendar, $hcId);

        // Partial: only the sent keys change; at least one of them. Values are checked like on create (422).
        $data = $this->decodeJson($request);
        if (!array_key_exists('name', $data) && !array_key_exists('url', $data)) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'name or url is required', Input::CODE, 'name');
        }
        $dto = new UpdateHolidayCalendarDto();
        $dto->name = self::stringValue($data, 'name');
        $dto->url = self::stringValue($data, 'url');
        $this->validateDto($dto, $validator);

        if (null !== $dto->name) {
            $hc->setName($dto->name);
        }
        if (null !== $dto->url) {
            $hc->setUrl($dto->url);
        }
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
        $hc = $this->find($calendar, $hcId);

        $this->em->remove($hc);
        $this->em->flush();

        return new JsonResponse(['ok' => true]);
    }

    #[Route('/{hcId}/refresh', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_MEMBER, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function refresh(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        string $hcId,
    ): JsonResponse {
        $hc = $this->find($calendar, $hcId);

        try {
            $eventCount = $this->holidayCalendarService->fetchAndStore($hc);
        } catch (\Throwable) {
            throw self::fetchFailed();
        }

        return new JsonResponse($this->serialize($hc, $eventCount));
    }

    /**
     * A sent `name` / `url`: null when the key is absent, else it must be a string (422 `validation_failed` on
     * the field, like the DTO constraints; never cast, so `5` or a list do not become a name).
     */
    private static function stringValue(array $data, string $key): ?string
    {
        if (!array_key_exists($key, $data)) {
            return null;
        }
        if (!is_string($data[$key])) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, sprintf('%s must be a string', $key), Input::CODE, $key);
        }

        return $data[$key];
    }

    /** The holiday calendar of this calendar; 404 (RFC 7807) for unknown ids and those of other calendars. */
    private function find(Calendar $calendar, string $hcId): HolidayCalendar
    {
        $hc = $this->holidayCalendarRepo->find($hcId);
        if (!$hc || $hc->getCalendar()->getId() !== $calendar->getId()) {
            throw new NotFoundHttpException('Holiday calendar not found');
        }

        return $hc;
    }

    /** 422 `ics_fetch_failed` on `url`: the feed could not be fetched or parsed (nothing was stored). */
    private static function fetchFailed(): ApiProblemException
    {
        return new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'Failed to fetch ICS feed. Please check the URL and try again.', 'ics_fetch_failed', 'url');
    }

    private function serialize(HolidayCalendar $hc, ?int $eventCount = null): array
    {
        return [
            'id' => $hc->getId(),
            'name' => $hc->getName(),
            'url' => $hc->getUrl(),
            'lastFetchedAt' => $hc->getLastFetchedAt()?->format(\DateTimeInterface::ATOM),
            'eventCount' => $eventCount ?? $hc->getEvents()->count(),
        ];
    }
}
