<?php

declare(strict_types=1);

namespace App\Controller;

use App\Enum\LegalDocumentType;
use App\Exception\ApiProblemException;
use App\Service\LegalDocumentService;
use App\Service\LegalPresenter;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

/** Public legal documents (imprint, privacy policy, terms of use). No authentication. */
#[Route('/api/legal')]
class LegalController extends AbstractController
{
    private const int CACHE_SECONDS = 60;

    public function __construct(private readonly LegalDocumentService $legal)
    {
    }

    /** `{imprint, privacy, terms}`: `{id, title, publishedAt}` of the current document, or null if not provided. */
    #[Route('', methods: ['GET'])]
    public function index(): JsonResponse
    {
        $result = [];
        foreach ($this->legal->currentAll() as $type => $doc) {
            $result[$type] = null === $doc ? null : LegalPresenter::summary($doc);
        }

        return $this->cached(new JsonResponse($result));
    }

    #[Route('/documents/{id}', methods: ['GET'], priority: 10)]
    public function version(string $id): JsonResponse
    {
        $doc = $this->legal->find($id);
        if (null === $doc) {
            throw self::notFound();
        }

        return $this->cached(new JsonResponse(LegalPresenter::full($doc)));
    }

    #[Route('/{type}', methods: ['GET'])]
    public function current(string $type): JsonResponse
    {
        $enum = LegalDocumentType::tryFrom($type);
        $doc = null === $enum ? null : $this->legal->current($enum);
        if (null === $doc) {
            throw self::notFound();
        }

        return $this->cached(new JsonResponse(LegalPresenter::full($doc)));
    }

    private function cached(JsonResponse $response): JsonResponse
    {
        $response->setPublic();
        $response->setMaxAge(self::CACHE_SECONDS);

        return $response;
    }

    private static function notFound(): ApiProblemException
    {
        return new ApiProblemException(404, 'Legal document not found', 'legal_document_not_found');
    }
}
