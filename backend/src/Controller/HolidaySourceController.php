<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\ClubUser;
use App\Enum\ClubRole;
use App\Exception\ApiProblemException;
use App\Security\CurrentUserResolver;
use App\Service\OpenHolidaysClient;
use App\Service\OpenHolidaysException;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/** Lists of the predefined holiday source (OpenHolidays) for club editors. */
#[Route('/api/holiday-sources')]
class HolidaySourceController extends AbstractApiController
{
    public function __construct(
        private readonly OpenHolidaysClient $client,
        private readonly CurrentUserResolver $userResolver,
        private readonly EntityManagerInterface $em,
    ) {
    }

    #[Route('/countries', methods: ['GET'])]
    public function countries(): JsonResponse
    {
        $language = $this->language();
        try {
            return new JsonResponse($this->client->countries($language));
        } catch (OpenHolidaysException) {
            throw self::unavailable();
        }
    }

    #[Route('/countries/{iso}/subdivisions', methods: ['GET'], requirements: ['iso' => '[A-Za-z]{2}'])]
    public function subdivisions(string $iso): JsonResponse
    {
        $language = $this->language();
        try {
            return new JsonResponse($this->client->subdivisions(strtoupper($iso), $language));
        } catch (OpenHolidaysException) {
            throw self::unavailable();
        }
    }

    /** Editor (or admin) of at least one club; returns the language of the user (de|en). */
    private function language(): string
    {
        $user = $this->userResolver->resolve();
        $isEditor = false;
        foreach ($this->em->getRepository(ClubUser::class)->findBy(['user' => $user]) as $membership) {
            if ($membership->getRole()->atLeast(ClubRole::EDITOR)) {
                $isEditor = true;
                break;
            }
        }
        if (!$isEditor) {
            throw new ApiProblemException(Response::HTTP_FORBIDDEN, 'Editor role required', 'forbidden');
        }

        return 'de' === $user->getLanguage() ? 'de' : 'en';
    }

    private static function unavailable(): ApiProblemException
    {
        return new ApiProblemException(Response::HTTP_UNPROCESSABLE_ENTITY, 'The holiday source is not reachable. Please try again later.', 'holiday_source_failed');
    }
}
