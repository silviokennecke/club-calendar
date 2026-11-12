<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\SecurityEventType;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/** Log row of a login or account-security action of a known user (times UTC). Not audited, not exposed in the API. */
#[ORM\Entity]
#[ORM\Index(name: 'idx_security_event_user_created', columns: ['user_id', 'created_at'])]
#[ORM\Index(name: 'idx_security_event_created', columns: ['created_at'])]
#[ORM\UniqueConstraint(name: 'uq_security_event_dedupe_key', columns: ['dedupe_key'])]
#[ORM\Index(name: 'idx_security_event_dedupe', columns: ['user_id', 'type', 'success', 'created_at'])]
class SecurityEvent
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(length: 40, enumType: SecurityEventType::class)]
    private SecurityEventType $type;

    #[ORM\Column(length: 30, nullable: true)]
    private ?string $method = null;

    #[ORM\Column(length: 40, nullable: true)]
    private ?string $provider = null;

    #[ORM\Column]
    private bool $success;

    /** Failures of the same kind within an hour are folded into one row and counted here. */
    #[ORM\Column(type: 'smallint', options: ['unsigned' => true, 'default' => 1])]
    private int $attempts = 1;

    #[ORM\Column(length: 45, nullable: true)]
    private ?string $ip = null;

    #[ORM\Column(length: 100, nullable: true)]
    private ?string $city = null;

    #[ORM\Column(length: 2, nullable: true, options: ['fixed' => true])]
    private ?string $country = null;

    #[ORM\Column(length: 100, nullable: true)]
    private ?string $browser = null;

    /** Full raw User-Agent (max. 512 characters), forensic only: never rendered in mails or UI. */
    #[ORM\Column(length: 512, nullable: true)]
    private ?string $userAgent = null;

    /** Hash of user, type, method, provider, IP and hour of a failure row; unique, so parallel failures fold into one row. */
    #[ORM\Column(type: 'string', length: 64, nullable: true, options: ['fixed' => true])]
    private ?string $dedupeKey = null;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    public function __construct(User $user, SecurityEventType $type, bool $success, \DateTimeImmutable $now = new \DateTimeImmutable())
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->user = $user;
        $this->type = $type;
        $this->success = $success;
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

    public function getType(): SecurityEventType
    {
        return $this->type;
    }

    public function getMethod(): ?string
    {
        return $this->method;
    }

    public function getProvider(): ?string
    {
        return $this->provider;
    }

    public function isSuccess(): bool
    {
        return $this->success;
    }

    public function getAttempts(): int
    {
        return $this->attempts;
    }

    public function getIp(): ?string
    {
        return $this->ip;
    }

    public function getCity(): ?string
    {
        return $this->city;
    }

    public function getCountry(): ?string
    {
        return $this->country;
    }

    public function getBrowser(): ?string
    {
        return $this->browser;
    }

    public function getUserAgent(): ?string
    {
        return $this->userAgent;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function setContext(?string $method, ?string $provider, ?string $ip, ?string $city, ?string $country, ?string $browser): static
    {
        $this->method = $method;
        $this->provider = $provider;
        $this->ip = $ip;
        $this->city = $city;
        $this->country = $country;
        $this->browser = $browser;

        return $this;
    }

    public function setAttempts(int $attempts): static
    {
        $this->attempts = $attempts;

        return $this;
    }
}
