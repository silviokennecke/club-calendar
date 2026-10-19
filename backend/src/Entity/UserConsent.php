<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\LegalDocumentType;
use App\Repository\UserConsentRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A user's consent to one exact version of a legal document. Never updated or deleted (full history), except
 * together with the user (ON DELETE CASCADE). `type` is denormalized from the document. Times are UTC.
 */
#[ORM\Entity(repositoryClass: UserConsentRepository::class)]
#[ORM\Index(name: 'idx_user_consent_user_document', columns: ['user_id', 'document_id'])]
class UserConsent
{
    public const int MAX_USER_AGENT_LENGTH = 512;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\ManyToOne(targetEntity: LegalDocument::class)]
    #[ORM\JoinColumn(name: 'document_id', nullable: false, onDelete: 'RESTRICT')]
    private LegalDocument $document;

    #[ORM\Column(length: 16, enumType: LegalDocumentType::class)]
    private LegalDocumentType $type;

    #[ORM\Column]
    private \DateTimeImmutable $consentedAt;

    #[ORM\Column(length: 45, nullable: true)]
    private ?string $ipAddress;

    #[ORM\Column(length: self::MAX_USER_AGENT_LENGTH, nullable: true)]
    private ?string $userAgent;

    public function __construct(User $user, LegalDocument $document, \DateTimeImmutable $consentedAt, ?string $ipAddress, ?string $userAgent)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->document = $document;
        $this->type = $document->getType();
        $this->consentedAt = $consentedAt;
        $this->ipAddress = null !== $ipAddress ? mb_substr($ipAddress, 0, 45) : null;
        $this->userAgent = null !== $userAgent ? mb_substr($userAgent, 0, self::MAX_USER_AGENT_LENGTH) : null;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getDocument(): LegalDocument
    {
        return $this->document;
    }

    public function getType(): LegalDocumentType
    {
        return $this->type;
    }

    public function getConsentedAt(): \DateTimeImmutable
    {
        return $this->consentedAt;
    }

    public function getIpAddress(): ?string
    {
        return $this->ipAddress;
    }

    public function getUserAgent(): ?string
    {
        return $this->userAgent;
    }
}
