<?php

declare(strict_types=1);

namespace App\Entity;

use App\Doctrine\Type\EncryptedTotpSecretType;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/** Authenticator-app (TOTP) factor of a user; the secret is encrypted at rest. Not audited. */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_user_totp_user', columns: ['user_id'])]
class UserTotp
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(type: EncryptedTotpSecretType::NAME, length: 255)]
    private string $secret;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    /** Time step of the last accepted code; only a greater step is accepted (replay protection). */
    #[ORM\Column(type: 'bigint', nullable: true)]
    private ?int $lastUsedStep = null;

    public function __construct(User $user, string $secret, \DateTimeImmutable $now = new \DateTimeImmutable())
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->secret = $secret;
        $this->createdAt = $now;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getUser(): User
    {
        return $this->user;
    }

    public function getSecret(): string
    {
        return $this->secret;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getLastUsedStep(): ?int
    {
        return $this->lastUsedStep;
    }

    public function setLastUsedStep(?int $lastUsedStep): static
    {
        $this->lastUsedStep = $lastUsedStep;

        return $this;
    }
}
