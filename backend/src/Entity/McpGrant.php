<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\McpGrantRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A user's consent for one client: the family of all codes and tokens issued from it (id = family). `scopes`
 * is a space-separated list (`mcp:read`, `mcp:write`); `expiresAt` is the absolute end of the grant however
 * often its refresh token rotates; `revokedAt` ends it. Times are UTC.
 */
#[ORM\Entity(repositoryClass: McpGrantRepository::class)]
#[ORM\Index(name: 'idx_mcp_grant_user', columns: ['user_id'])]
#[ORM\Index(name: 'idx_mcp_grant_client', columns: ['client_id'])]
class McpGrant
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\ManyToOne(targetEntity: OAuthClient::class)]
    #[ORM\JoinColumn(name: 'client_id', nullable: false, onDelete: 'CASCADE')]
    private OAuthClient $client;

    #[ORM\Column(length: 100)]
    private string $scopes;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $revokedAt = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $lastUsedAt = null;

    public function __construct(User $user, OAuthClient $client, string $scopes, \DateTimeImmutable $createdAt, \DateTimeImmutable $expiresAt)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->client = $client;
        $this->scopes = $scopes;
        $this->createdAt = $createdAt;
        $this->expiresAt = $expiresAt;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getClient(): OAuthClient
    {
        return $this->client;
    }

    public function getScopes(): string
    {
        return $this->scopes;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getRevokedAt(): ?\DateTimeImmutable
    {
        return $this->revokedAt;
    }

    public function revoke(\DateTimeImmutable $now): void
    {
        $this->revokedAt ??= $now;
    }

    public function getLastUsedAt(): ?\DateTimeImmutable
    {
        return $this->lastUsedAt;
    }

    public function touch(\DateTimeImmutable $now): void
    {
        $this->lastUsedAt = $now;
    }
}
