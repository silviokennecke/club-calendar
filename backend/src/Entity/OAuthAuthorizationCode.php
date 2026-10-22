<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\OAuthAuthorizationCodeRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * An authorization code, valid 60 seconds, single use. Only the SHA-256 hash is stored. A second redemption
 * (`usedAt` set) revokes the grant. Times are UTC.
 */
#[ORM\Entity(repositoryClass: OAuthAuthorizationCodeRepository::class)]
#[ORM\UniqueConstraint(name: 'uq_oauth_authorization_code_hash', columns: ['code_hash'])]
#[ORM\Index(name: 'idx_oauth_authorization_code_expires_at', columns: ['expires_at'])]
class OAuthAuthorizationCode
{
    public const int TTL_SECONDS = 60;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\Column(length: 64)]
    private string $codeHash;

    #[ORM\ManyToOne(targetEntity: McpGrant::class)]
    #[ORM\JoinColumn(name: 'grant_id', nullable: false, onDelete: 'CASCADE')]
    private McpGrant $grant;

    #[ORM\Column(length: 2048)]
    private string $redirectUri;

    #[ORM\Column(length: 128)]
    private string $codeChallenge;

    #[ORM\Column(length: 2048)]
    private string $resource;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    public function __construct(string $codeHash, McpGrant $grant, string $redirectUri, string $codeChallenge, string $resource, \DateTimeImmutable $createdAt)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->codeHash = $codeHash;
        $this->grant = $grant;
        $this->redirectUri = $redirectUri;
        $this->codeChallenge = $codeChallenge;
        $this->resource = $resource;
        $this->createdAt = $createdAt;
        $this->expiresAt = $createdAt->modify(sprintf('+%d seconds', self::TTL_SECONDS));
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getCodeHash(): string
    {
        return $this->codeHash;
    }

    public function getGrant(): McpGrant
    {
        return $this->grant;
    }

    public function getRedirectUri(): string
    {
        return $this->redirectUri;
    }

    public function getCodeChallenge(): string
    {
        return $this->codeChallenge;
    }

    public function getResource(): string
    {
        return $this->resource;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getUsedAt(): ?\DateTimeImmutable
    {
        return $this->usedAt;
    }
}
