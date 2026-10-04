<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * A consumed one-time value (WebAuthn challenge, OAuth state). Written by {@see \App\Security\NonceStore}
 * through DBAL so that a duplicate insert (replay) fails atomically on the unique index.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_auth_nonce_hash', columns: ['nonce_hash'])]
#[ORM\Index(name: 'idx_auth_nonce_expires_at', columns: ['expires_at'])]
class AuthNonce
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\Column(length: 64)]
    private string $nonceHash;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    public function __construct(string $nonceHash, \DateTimeImmutable $expiresAt)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->nonceHash = $nonceHash;
        $this->expiresAt = $expiresAt;
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getNonceHash(): string
    {
        return $this->nonceHash;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }
}
