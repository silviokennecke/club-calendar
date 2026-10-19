<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\LegalDocument;
use App\Entity\User;
use App\Exception\ApiProblemException;

/** Consent rules of the HTTP layer on top of LegalDocumentService: registration, `/api/auth/consents`. */
readonly class LegalConsentService
{
    private const int MAX_IDS = 20;

    public function __construct(private LegalDocumentService $legal)
    {
    }

    /** @return list<LegalDocument> */
    public function pending(User $user): array
    {
        return $this->legal->pendingConsents($user);
    }

    /**
     * Registration: every consent type with a current document must be accepted with its current id.
     *
     * @param array<mixed> $ids
     *
     * @return list<LegalDocument> the accepted current documents (to be stored)
     */
    public function assertAccepted(array $ids): array
    {
        $docs = $this->resolve($ids);
        $current = $this->legal->currentOfConsentTypes();
        $accepted = [];
        $missing = [];
        $outdated = false;
        foreach ($current as $type => $doc) {
            if (isset($docs[$doc->getId()])) {
                $accepted[] = $doc;
                continue;
            }
            $missing[] = $doc;
            foreach ($docs as $given) {
                $outdated = $outdated || $given->getType()->value === $type;
            }
        }
        if ([] !== $missing) {
            throw self::problem($outdated ? 'consent_outdated' : 'consent_required', $missing);
        }

        return $accepted;
    }

    /** @param list<LegalDocument> $docs */
    public function record(User $user, array $docs, ?string $ip, ?string $userAgent): void
    {
        if ([] !== $docs) {
            $this->legal->recordConsents($user, $docs, $ip, $userAgent);
        }
    }

    /**
     * `POST /api/auth/consents`: all ids must be current privacy/terms documents.
     *
     * @param list<string> $ids
     */
    public function giveConsents(User $user, array $ids, ?string $ip, ?string $userAgent): void
    {
        $docs = $this->resolve($ids);
        $current = $this->legal->currentOfConsentTypes();
        $currentIds = array_map(static fn (LegalDocument $d): string => $d->getId(), $current);
        foreach ($docs as $id => $doc) {
            if (!in_array($id, $currentIds, true)) {
                throw self::problem('consent_outdated', $this->legal->pendingConsents($user));
            }
        }
        $this->legal->recordConsents($user, array_values($docs), $ip, $userAgent);
    }

    /** @return list<array<string, mixed>> */
    public function consentHistory(User $user): array
    {
        $currentIds = [];
        foreach ($this->legal->currentAll() as $type => $doc) {
            if (null !== $doc) {
                $currentIds[$type] = $doc->getId();
            }
        }

        return array_map(static fn ($c): array => LegalPresenter::consent($c, $currentIds), $this->legal->history($user));
    }

    /**
     * Ids to documents (any version); unknown or malformed ids are 400 validation_failed.
     *
     * @param array<mixed> $ids
     *
     * @return array<string, LegalDocument> id => document
     */
    private function resolve(array $ids): array
    {
        if (count($ids) > self::MAX_IDS) {
            throw Input::invalid('acceptedDocuments', 'Too many document ids');
        }
        $docs = [];
        foreach ($ids as $id) {
            $doc = is_string($id) && '' !== $id && strlen($id) <= 36 ? $this->legal->find($id) : null;
            if (null === $doc) {
                throw Input::invalid('acceptedDocuments', 'Unknown legal document id');
            }
            $docs[$doc->getId()] = $doc;
        }

        return $docs;
    }

    /** @param list<LegalDocument> $documents */
    private static function problem(string $code, array $documents): ApiProblemException
    {
        return new ApiProblemException(
            422,
            'consent_required' === $code ? 'Consent to the current legal documents is required' : 'The legal documents have changed',
            $code,
            'acceptedDocuments',
            [],
            null,
            ['documents' => LegalPresenter::refs($documents)],
        );
    }
}
