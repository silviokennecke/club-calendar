<?php

declare(strict_types=1);

namespace App\Repository;

use App\Entity\LegalDocument;
use App\Enum\LegalDocumentType;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<LegalDocument>
 */
class LegalDocumentRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, LegalDocument::class);
    }

    /** Latest version of the type, retired or not. */
    public function findLatest(LegalDocumentType $type): ?LegalDocument
    {
        return $this->findOneBy(['type' => $type], ['publishedAt' => 'DESC', 'id' => 'DESC']);
    }

    /** The current document: the latest version, unless it is retired. */
    public function findCurrent(LegalDocumentType $type): ?LegalDocument
    {
        $latest = $this->findLatest($type);

        return null !== $latest && !$latest->isRetired() ? $latest : null;
    }

    /**
     * The current documents of the given types in ONE query (latest version per type, retired ones left out).
     *
     * @param list<LegalDocumentType> $types
     *
     * @return array<string, LegalDocument> type value => document
     */
    public function findCurrentOfTypes(array $types): array
    {
        if ([] === $types) {
            return [];
        }
        /** @var list<LegalDocument> $rows */
        $rows = $this->createQueryBuilder('d')
            ->where('d.type IN (:types)')
            ->andWhere('d.publishedAt = (SELECT MAX(d2.publishedAt) FROM '.LegalDocument::class.' d2 WHERE d2.type = d.type)')
            ->setParameter('types', array_map(static fn (LegalDocumentType $t): string => $t->value, $types))
            ->getQuery()
            ->getResult();

        // Several versions with the same timestamp: the highest id (UUID v7, newest) wins, as in findLatest().
        $latest = [];
        foreach ($rows as $row) {
            $key = $row->getType()->value;
            if (!isset($latest[$key]) || strcmp($row->getId(), $latest[$key]->getId()) > 0) {
                $latest[$key] = $row;
            }
        }

        return array_filter($latest, static fn (LegalDocument $d): bool => !$d->isRetired());
    }
}
