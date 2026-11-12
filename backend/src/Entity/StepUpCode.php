<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * The mailed confirmation code of a step-up for an account without a password: at most one per user (a new code
 * replaces the old), only the keyed hash is stored, single use, valid 10 minutes. Written and consumed by
 * {@see \App\Service\ReauthenticationService} with plain SQL. Times are UTC.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_step_up_code_user', columns: ['user_id'])]
class StepUpCode
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 64)]
    private string $codeHash;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $user, string $codeHash, \DateTimeImmutable $now, \DateTimeImmutable $expiresAt)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->codeHash = $codeHash;
        $this->createdAt = $now;
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

    public function getCodeHash(): string
    {
        return $this->codeHash;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }
}
