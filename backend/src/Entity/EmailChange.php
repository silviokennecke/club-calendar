<?php

declare(strict_types=1);

namespace App\Entity;

use App\Service\EmailAddress;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A pending change of a user's e-mail address: the new address waits here until the link sent to it is
 * opened. Only the SHA-256 hash of the random token is stored. Times are UTC.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_email_change_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_email_change_expires_at', columns: ['expires_at'])]
class EmailChange
{
    public const int TTL_SECONDS = 24 * 3600;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 255)]
    private string $newEmail;

    #[ORM\Column(length: 64)]
    private string $tokenHash;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $user, string $newEmail, string $tokenHash, \DateTimeImmutable $now)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->newEmail = EmailAddress::normalize($newEmail);
        $this->tokenHash = $tokenHash;
        $this->createdAt = $now;
        $this->expiresAt = $now->modify('+'.self::TTL_SECONDS.' seconds');
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getNewEmail(): string
    {
        return $this->newEmail;
    }

    public function getTokenHash(): string
    {
        return $this->tokenHash;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getUsedAt(): ?\DateTimeImmutable
    {
        return $this->usedAt;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
