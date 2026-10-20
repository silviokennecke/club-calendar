<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\LegalDocument;
use App\Entity\UserConsent;

/** JSON shapes of the legal documents and consents (API responses and error members). */
final class LegalPresenter
{
    public static function time(\DateTimeImmutable $time): string
    {
        return $time->setTimezone(new \DateTimeZone('UTC'))->format(\DateTimeInterface::ATOM);
    }

    /** @return array{id: string, title: ?string, url: ?string, publishedAt: string} */
    public static function summary(LegalDocument $doc): array
    {
        return ['id' => $doc->getId(), 'title' => $doc->getTitle(), 'url' => $doc->getUrl(), 'publishedAt' => self::time($doc->getPublishedAt())];
    }

    /** @return array{id: string, type: string, title: ?string, url: ?string, html: string, publishedAt: string} */
    public static function full(LegalDocument $doc): array
    {
        return [
            'id' => $doc->getId(),
            'type' => $doc->getType()->value,
            'title' => $doc->getTitle(),
            'url' => $doc->getUrl(),
            'html' => $doc->getHtml(),
            'publishedAt' => self::time($doc->getPublishedAt()),
        ];
    }

    /**
     * @param list<LegalDocument> $docs
     *
     * @return list<array{type: string, id: string, title: ?string, url: ?string, publishedAt: string}>
     */
    public static function pending(array $docs): array
    {
        return array_map(static fn (LegalDocument $d): array => ['type' => $d->getType()->value] + self::summary($d), $docs);
    }

    /**
     * The `documents` member of consent errors.
     *
     * @param list<LegalDocument> $docs
     *
     * @return list<array{type: string, id: string}>
     */
    public static function refs(array $docs): array
    {
        return array_map(static fn (LegalDocument $d): array => ['type' => $d->getType()->value, 'id' => $d->getId()], $docs);
    }

    /**
     * @param array<string, string> $currentIds type value => id of the current document
     *
     * @return array<string, mixed>
     */
    public static function consent(UserConsent $c, array $currentIds): array
    {
        $doc = $c->getDocument();

        return [
            'id' => $c->getId(),
            'type' => $c->getType()->value,
            'documentId' => $doc->getId(),
            'documentTitle' => $doc->getTitle(),
            'documentUrl' => $doc->getUrl(),
            'documentPublishedAt' => self::time($doc->getPublishedAt()),
            'consentedAt' => self::time($c->getConsentedAt()),
            'current' => ($currentIds[$c->getType()->value] ?? null) === $doc->getId(),
            'ipAddress' => $c->getIpAddress(),
            'userAgent' => $c->getUserAgent(),
        ];
    }
}
