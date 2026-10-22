<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\OAuthClientRepository;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A public OAuth client created by dynamic client registration (RFC 7591). The id is the `client_id`; there is
 * no secret (PKCE only). `redirectUris` is a JSON-encoded list of exact redirect URIs. Times are UTC.
 */
#[ORM\Entity(repositoryClass: OAuthClientRepository::class)]
#[ORM\Index(name: 'idx_oauth_client_created_at', columns: ['created_at'])]
class OAuthClient
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\Column(length: 255)]
    private string $clientName;

    #[ORM\Column(type: 'text')]
    private string $redirectUris;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    /** The matched `MCP_ALLOWED_CLIENTS` family (claude, openai, ...); null when every client was allowed. */
    #[ORM\Column(length: 20, nullable: true)]
    private ?string $family = null;

    /** @param list<string> $redirectUris */
    public function __construct(string $clientName, array $redirectUris, \DateTimeImmutable $createdAt, ?string $family = null)
    {
        $this->family = $family;
        $this->id = Uuid::v7()->toRfc4122();
        $this->clientName = $clientName;
        $this->redirectUris = json_encode(array_values($redirectUris), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $this->createdAt = $createdAt;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getClientName(): string
    {
        return $this->clientName;
    }

    /** @return list<string> */
    public function getRedirectUris(): array
    {
        /* @var list<string> */
        return json_decode($this->redirectUris, true, 512, JSON_THROW_ON_ERROR);
    }

    public function getFamily(): ?string
    {
        return $this->family;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
