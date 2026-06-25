<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Calendar;
use App\Security\ArchivedCalendarVoter;
use App\Security\CalendarMemberVoter;
use App\Service\EventTemplateService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/calendars/{calendarId}/templates')]
class EventTemplateController extends AbstractApiController
{
    public function __construct(
        private readonly EventTemplateService $templateService,
        private readonly EntityManagerInterface $em,
    ) {}

    #[Route('', methods: ['GET'])]
    public function list(int $calendarId): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: true);

        return new JsonResponse($this->templateService->listTemplates($calendar));
    }

    #[Route('', methods: ['POST'])]
    public function create(int $calendarId, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);

        return new JsonResponse($this->templateService->createTemplate($calendar, $data), Response::HTTP_CREATED);
    }

    #[Route('/{id}', methods: ['GET'])]
    public function getOne(int $calendarId, int $id): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: true);

        return new JsonResponse($this->templateService->getTemplate($id, $calendar));
    }

    #[Route('/{id}', methods: ['PATCH'])]
    public function update(int $calendarId, int $id, Request $request): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $data = $this->decodeJson($request);

        return new JsonResponse($this->templateService->updateTemplate($id, $calendar, $data));
    }

    #[Route('/{id}', methods: ['DELETE'])]
    public function delete(int $calendarId, int $id): JsonResponse
    {
        $calendar = $this->findCalendar($calendarId, readOnly: false);
        $this->templateService->deleteTemplate($id, $calendar);

        return new JsonResponse(['ok' => true]);
    }

    private function findCalendar(int $calendarId, bool $readOnly): Calendar
    {
        $calendar = $this->em->getRepository(Calendar::class)->find($calendarId);
        if (!$calendar) {
            throw new NotFoundHttpException('Calendar not found');
        }
        $this->denyAccessUnlessGranted(CalendarMemberVoter::CALENDAR_MEMBER, $calendar);
        if (!$readOnly) {
            $this->denyAccessUnlessGranted(ArchivedCalendarVoter::NOT_ARCHIVED, $calendar);
        }

        return $calendar;
    }
}
