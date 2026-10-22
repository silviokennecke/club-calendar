<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\McpTokenRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * An opaque access or refresh token of a grant. Only the SHA-256 hash of the random token is stored.
 * A refresh token gets `rotatedAt` when it is exchanged (single use, see AuthService::refresh for the model).
 * Times are UTC.
 */
#[ORM\Entity(repositoryClass: McpTokenRepository::class)]
#[ORM\UniqueConstraint(name: 'uq_mcp_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_mcp_token_grant', columns: ['grant_id'])]
#[ORM\Index(name: 'idx_mcp_token_expires_at', columns: ['expires_at'])]
class McpToken
{
    public const string ACCESS = 'access';
    public const string REFRESH = 'refresh';

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: McpGrant::class)]
    #[ORM\JoinColumn(name: 'grant_id', nullable: false, onDelete: 'CASCADE')]
    private McpGrant $grant;

    #[ORM\Column(length: 7)]
    private string $type;

    #[ORM\Column(length: 64)]
    private string $tokenHash;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $rotatedAt = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $lastUsedAt = null;

    public function __construct(McpGrant $grant, string $type, string $tokenHash, \DateTimeImmutable $createdAt, \DateTimeImmutable $expiresAt)
    {
        if (self::ACCESS !== $type && self::REFRESH !== $type) {
            throw new \InvalidArgumentException('Unknown token type');
        }
        $this->id = Uuid::v7()->toRfc4122();
        $this->grant = $grant;
        $this->type = $type;
        $this->tokenHash = $tokenHash;
        $this->createdAt = $createdAt;
        $this->expiresAt = $expiresAt;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getGrant(): McpGrant
    {
        return $this->grant;
    }

    public function getType(): string
    {
        return $this->type;
    }

    public function getTokenHash(): string
    {
        return $this->tokenHash;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getRotatedAt(): ?\DateTimeImmutable
    {
        return $this->rotatedAt;
    }

    public function getLastUsedAt(): ?\DateTimeImmutable
    {
        return $this->lastUsedAt;
    }
}
