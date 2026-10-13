<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * One-time password reset link. Only the SHA-256 hash of the random token is stored; the token itself
 * exists only in the e-mail (or the output of `app:user:reset-link`). Times are UTC.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_password_reset_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_password_reset_expires_at', columns: ['expires_at'])]
class PasswordReset
{
    public const int TTL_SECONDS = 3600;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 64)]
    private string $tokenHash;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $user, string $tokenHash, \DateTimeImmutable $now)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
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
