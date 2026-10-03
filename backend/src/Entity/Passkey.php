<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class Passkey
{
    #[ORM\Id]
    #[ORM\Column(length: 255)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class, inversedBy: 'passkeys')]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 700, unique: true)]
    private string $credentialId;

    // A blob column is hydrated as a stream resource, so the property cannot be typed `string`.
    /** @var string|resource */
    #[ORM\Column(type: 'blob')]
    private mixed $publicKey;

    #[ORM\Column(type: 'bigint', options: ['default' => 0])]
    private int $counter = 0;

    #[ORM\Column(length: 255, nullable: true)]
    private ?string $deviceName = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct()
    {
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function setId(string $id): static
    {
        $this->id = $id;

        return $this;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function setUser(User $user): static
    {
        $this->user = $user;

        return $this;
    }

    public function getCredentialId(): string
    {
        return $this->credentialId;
    }

    public function setCredentialId(string $credentialId): static
    {
        $this->credentialId = $credentialId;

        return $this;
    }

    public function getPublicKey(): string
    {
        if (is_resource($this->publicKey)) {
            rewind($this->publicKey);

            return (string) stream_get_contents($this->publicKey);
        }

        return $this->publicKey;
    }

    public function setPublicKey(string $publicKey): static
    {
        $this->publicKey = $publicKey;

        return $this;
    }

    public function getCounter(): int
    {
        return $this->counter;
    }

    public function setCounter(int $counter): static
    {
        $this->counter = $counter;

        return $this;
    }

    public function getDeviceName(): ?string
    {
        return $this->deviceName;
    }

    public function setDeviceName(?string $deviceName): static
    {
        $this->deviceName = $deviceName;

        return $this;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function setCreatedAt(\DateTimeImmutable $createdAt): static
    {
        $this->createdAt = $createdAt;

        return $this;
    }
}
