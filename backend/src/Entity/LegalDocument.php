<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\LegalDocumentType;
use App\Repository\LegalDocumentRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * One version of a legal document (imprint, privacy policy, terms). A new row is created whenever the source file
 * content changes (SHA-256 `contentHash`); the id is the version. The current document of a type is its latest
 * row that is not retired. Rows are never deleted: consents reference them. Times are UTC.
 */
#[ORM\Entity(repositoryClass: LegalDocumentRepository::class)]
#[ORM\Index(name: 'idx_legal_document_type_published', columns: ['type', 'published_at'])]
class LegalDocument
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\Column(length: 16, enumType: LegalDocumentType::class)]
    private LegalDocumentType $type;

    #[ORM\Column(type: 'string', length: 64, options: ['fixed' => true])]
    private string $contentHash;

    #[ORM\Column(type: 'text', length: 16777215)]
    private string $markdown;

    #[ORM\Column(type: 'text', length: 16777215)]
    private string $html;

    #[ORM\Column(length: 255, nullable: true)]
    private ?string $title;

    #[ORM\Column]
    private \DateTimeImmutable $publishedAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $retiredAt = null;

    public function __construct(
        LegalDocumentType $type,
        string $contentHash,
        string $markdown,
        string $html,
        ?string $title,
        \DateTimeImmutable $publishedAt,
    ) {
        $this->id = Uuid::v7()->toRfc4122();
        $this->type = $type;
        $this->contentHash = $contentHash;
        $this->markdown = $markdown;
        $this->html = $html;
        $this->title = $title;
        $this->publishedAt = $publishedAt;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getType(): LegalDocumentType
    {
        return $this->type;
    }

    public function getContentHash(): string
    {
        return $this->contentHash;
    }

    public function getMarkdown(): string
    {
        return $this->markdown;
    }

    public function getHtml(): string
    {
        return $this->html;
    }

    public function getTitle(): ?string
    {
        return $this->title;
    }

    public function getPublishedAt(): \DateTimeImmutable
    {
        return $this->publishedAt;
    }

    public function getRetiredAt(): ?\DateTimeImmutable
    {
        return $this->retiredAt;
    }

    public function isRetired(): bool
    {
        return null !== $this->retiredAt;
    }

    public function retire(\DateTimeImmutable $now): void
    {
        $this->retiredAt = $now;
    }

    public function restore(): void
    {
        $this->retiredAt = null;
    }
}
