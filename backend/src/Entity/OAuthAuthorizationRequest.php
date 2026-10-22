<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\OAuthAuthorizationRequestRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A validated, still unanswered authorization request (the consent page works on its id). Valid 10 minutes,
 * single use (deleted when answered). Times are UTC.
 */
#[ORM\Entity(repositoryClass: OAuthAuthorizationRequestRepository::class)]
#[ORM\Index(name: 'idx_oauth_authorization_request_expires_at', columns: ['expires_at'])]
class OAuthAuthorizationRequest
{
    public const int TTL_SECONDS = 600;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: OAuthClient::class)]
    #[ORM\JoinColumn(name: 'client_id', nullable: false, onDelete: 'CASCADE')]
    private OAuthClient $client;

    #[ORM\Column(length: 2048)]
    private string $redirectUri;

    #[ORM\Column(length: 100)]
    private string $scopes;

    #[ORM\Column(length: 128)]
    private string $codeChallenge;

    #[ORM\Column(length: 2048, nullable: true)]
    private ?string $state;

    /** The canonical MCP resource the token is bound to (RFC 8707). */
    #[ORM\Column(length: 2048)]
    private string $resource;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    public function __construct(OAuthClient $client, string $redirectUri, string $scopes, string $codeChallenge, ?string $state, string $resource, \DateTimeImmutable $createdAt)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->client = $client;
        $this->redirectUri = $redirectUri;
        $this->scopes = $scopes;
        $this->codeChallenge = $codeChallenge;
        $this->state = $state;
        $this->resource = $resource;
        $this->createdAt = $createdAt;
        $this->expiresAt = $createdAt->modify(sprintf('+%d seconds', self::TTL_SECONDS));
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getClient(): OAuthClient
    {
        return $this->client;
    }

    public function getRedirectUri(): string
    {
        return $this->redirectUri;
    }

    public function getScopes(): string
    {
        return $this->scopes;
    }

    public function getCodeChallenge(): string
    {
        return $this->codeChallenge;
    }

    public function getState(): ?string
    {
        return $this->state;
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
}
