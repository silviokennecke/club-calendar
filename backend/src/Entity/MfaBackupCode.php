<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/** One single-use backup code (SHA-256 hex of the normalised code; the code itself is never stored). Not audited. */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_mfa_backup_code_hash', columns: ['code_hash'])]
#[ORM\Index(name: 'idx_mfa_backup_code_user', columns: ['user_id'])]
class MfaBackupCode
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(type: 'string', length: 64, options: ['fixed' => true])]
    private string $codeHash;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $usedAt = null;

    public function __construct(User $user, string $codeHash, \DateTimeImmutable $now = new \DateTimeImmutable())
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->codeHash = $codeHash;
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

    public function getCodeHash(): string
    {
        return $this->codeHash;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getUsedAt(): ?\DateTimeImmutable
    {
        return $this->usedAt;
    }
}
