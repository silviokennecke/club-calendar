<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\RefreshTokenRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * One issued refresh token. The id is the token's `jti`; tokens of one session share a `familyId` (`fam`).
 * Every refresh rotates: the presented token gets `rotatedAt`, a new row of the same family is issued. The
 * token itself is an HMAC-signed JWT (forging needs the server secret), so nothing secret is stored.
 * `familyExpiresAt` is the absolute end of the session (copied to every rotated token); `revokedAt` ends a
 * token (set on all rows of a family by logout, reuse detection and "sign out everywhere"). Times are UTC.
 */
#[ORM\Entity(repositoryClass: RefreshTokenRepository::class)]
#[ORM\Index(name: 'idx_refresh_token_family', columns: ['family_id'])]
#[ORM\Index(name: 'idx_refresh_token_user', columns: ['user_id'])]
#[ORM\Index(name: 'idx_refresh_token_family_expires_at', columns: ['family_expires_at'])]
class RefreshToken
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\Column(length: 36)]
    private string $familyId;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column]
    private \DateTimeImmutable $issuedAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column]
    private \DateTimeImmutable $familyExpiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $rotatedAt = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $revokedAt = null;

    public function __construct(User $user, ?string $familyId, \DateTimeImmutable $issuedAt, \DateTimeImmutable $expiresAt, \DateTimeImmutable $familyExpiresAt)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->familyId = $familyId ?? Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->issuedAt = $issuedAt;
        $this->expiresAt = $expiresAt;
        $this->familyExpiresAt = $familyExpiresAt;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getFamilyId(): string
    {
        return $this->familyId;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getIssuedAt(): \DateTimeImmutable
    {
        return $this->issuedAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getFamilyExpiresAt(): \DateTimeImmutable
    {
        return $this->familyExpiresAt;
    }

    public function getRotatedAt(): ?\DateTimeImmutable
    {
        return $this->rotatedAt;
    }

    public function getRevokedAt(): ?\DateTimeImmutable
    {
        return $this->revokedAt;
    }
}
