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
}
