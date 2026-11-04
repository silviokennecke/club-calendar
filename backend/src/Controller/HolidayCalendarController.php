<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Holiday\CreateHolidayCalendarDto;
use App\Dto\Holiday\UpdateHolidayCalendarDto;
use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Enum\HolidaySource;
use App\Enum\HolidayType;
use App\Exception\ApiProblemException;
use App\Repository\HolidayCalendarRepository;
use App\Security\ArchivedCalendarVoter;
use App\Security\AuthRateLimiter;
use App\Security\CalendarMemberVoter;
use App\Security\CurrentUserResolver;
use App\Service\HolidayCalendarService;
use App\Service\Input;
use App\Service\Quota;
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
        private readonly Quota $quota,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
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
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function create(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
        ValidatorInterface $validator,
    ): JsonResponse {
        $this->rateLimiter->assertHolidayFetchAllowed($this->userResolver->resolve()->getId());
        $data = $this->decodeJson($request);
        $dto = new CreateHolidayCalendarDto();
        $dto->name = self::stringValue($data, 'name') ?? '';
        $dto->url = self::stringValue($data, 'url') ?? '';
        $dto->type = self::stringValue($data, 'type') ?? 'other';
        $this->validateDto($dto, $validator);
        $this->quota->assertRoom(Quota::HOLIDAY_CALENDARS_PER_CALENDAR, $calendar);

        $hc = new HolidayCalendar($calendar, $dto->name, $dto->url);
        $hc->setType(HolidayType::from($dto->type));
        try {
            $eventCount = $this->holidayCalendarService->createAndStore($hc);
        } catch (\Throwable) {
            throw self::fetchFailed();
        }

        return new JsonResponse($this->serialize($hc, $eventCount), Response::HTTP_CREATED);
    }

    #[Route('/predefined', methods: ['POST'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function createPredefined(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        Request $request,
    ): JsonResponse {
        $data = $this->decodeJson($request);
        $country = self::stringValue($data, 'country') ?? '';
        if (1 !== preg_match('/^[A-Za-z]{2}$/', $country)) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'country must be an ISO 3166-1 alpha-2 code', Input::CODE, 'country');
        }
        $subdivision = self::stringValue($data, 'subdivision');
        if (null !== $subdivision && '' !== $subdivision && 1 !== preg_match('/^[A-Za-z0-9-]{2,16}$/', $subdivision)) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'subdivision is not a valid code', Input::CODE, 'subdivision');
        }
        $subdivision = '' === $subdivision ? null : $subdivision;
        $regionName = trim(self::stringValue($data, 'regionName') ?? '');
        if (mb_strlen($regionName) > 150) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'regionName is too long', Input::CODE, 'regionName');
        }
        $kinds = $data['kinds'] ?? null;
        if (!is_array($kinds) || [] === $kinds || [] !== array_diff($kinds, ['public', 'school'])) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'kinds must be a non-empty list of public|school', Input::CODE, 'kinds');
        }
        $kinds = array_values(array_unique($kinds));
        $this->quota->assertRoom(Quota::HOLIDAY_CALENDARS_PER_CALENDAR, $calendar, count($kinds));

        $user = $this->userResolver->resolve();
        $language = 'de' === $user->getLanguage() ? 'de' : 'en';
        if ('' === $regionName) {
            $regionName = strtoupper($subdivision ?? $country);
        }

        try {
            $created = $this->holidayCalendarService->createPredefined($calendar, $country, $subdivision, $kinds, $language, $regionName);
        } catch (\Throwable) {
            throw self::sourceFailed();
        }

        return new JsonResponse(array_map(fn (array $c) => $this->serialize($c['calendar'], $c['eventCount']), $created), Response::HTTP_CREATED);
    }

    #[Route('/{hcId}', methods: ['PATCH'])]
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
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
        if (!array_key_exists('name', $data) && !array_key_exists('url', $data) && !array_key_exists('type', $data)) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'name, url or type is required', Input::CODE, 'name');
        }
        $dto = new UpdateHolidayCalendarDto();
        $dto->name = self::stringValue($data, 'name');
        $dto->url = self::stringValue($data, 'url');
        $dto->type = self::stringValue($data, 'type');
        $this->validateDto($dto, $validator);

        if (HolidaySource::OPENHOLIDAYS === $hc->getSource() && (null !== $dto->url || null !== $dto->type)) {
            throw new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'url and type of a predefined holiday calendar cannot be changed', Input::CODE, null !== $dto->type ? 'type' : 'url');
        }
        if (null !== $dto->type) {
            $hc->setType(HolidayType::from($dto->type));
        }
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
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
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
    #[IsGranted(CalendarMemberVoter::CALENDAR_EDITOR, subject: 'calendar')]
    #[IsGranted(ArchivedCalendarVoter::NOT_ARCHIVED, subject: 'calendar')]
    public function refresh(
        #[MapEntity(id: 'calendarId')] Calendar $calendar,
        string $hcId,
    ): JsonResponse {
        $hc = $this->find($calendar, $hcId);
        $this->rateLimiter->assertHolidayFetchAllowed($this->userResolver->resolve()->getId());

        try {
            $eventCount = $this->holidayCalendarService->fetchAndStore($hc);
        } catch (\Throwable) {
            throw HolidaySource::OPENHOLIDAYS === $hc->getSource() ? self::sourceFailed() : self::fetchFailed();
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

    private static function sourceFailed(): ApiProblemException
    {
        return new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'Failed to fetch holidays from the holiday source. Please try again later.', 'holiday_source_failed');
    }

    private function serialize(HolidayCalendar $hc, ?int $eventCount = null): array
    {
        return [
            'id' => $hc->getId(),
            'name' => $hc->getName(),
            'url' => $hc->getUrl(),
            'type' => $hc->getType()->value,
            'source' => $hc->getSource()->value,
            'sourceCountry' => $hc->getSourceCountry(),
            'sourceSubdivision' => $hc->getSourceSubdivision(),
            'sourceLanguage' => $hc->getSourceLanguage(),
            'lastFetchedAt' => $hc->getLastFetchedAt()?->format(\DateTimeInterface::ATOM),
            'eventCount' => $eventCount ?? $hc->getEvents()->count(),
        ];
    }
}
