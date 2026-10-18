<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\ClubRole;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

/**
 * Invitation of an e-mail address to a club (security audit M8: nobody is added without consent). The address is
 * stored normalized (trimmed, lower case) and is matched against the VERIFIED address of the user who answers.
 * Only the SHA-256 hash of the random token is stored; the token exists only in the e-mail. Times are UTC.
 *
 * `status` is pending, accepted or declined; "expired" is not stored but computed (pending and `expiresAt`
 * in the past), so an expired invitation stays visible to the club and can be re-sent.
 */
#[ORM\Entity]
#[ORM\UniqueConstraint(name: 'uq_club_invitation_token_hash', columns: ['token_hash'])]
#[ORM\Index(name: 'idx_club_invitation_club_email', columns: ['club_id', 'email'])]
#[ORM\Index(name: 'idx_club_invitation_email_status', columns: ['email', 'status'])]
class ClubInvitation
{
    public const string PENDING = 'pending';
    public const string ACCEPTED = 'accepted';
    public const string DECLINED = 'declined';

    public const int TTL_DAYS = 7;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Club::class)]
    #[ORM\JoinColumn(name: 'club_id', nullable: false, onDelete: 'CASCADE')]
    private Club $club;

    /** Null once the inviting account is deleted. */
    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'invited_by_id', nullable: true, onDelete: 'SET NULL')]
    private ?User $invitedBy;

    /** Binary collation: SQL matches are as strict as the PHP comparison (no "é" = "e"). */
    #[ORM\Column(length: 254, options: ['collation' => 'utf8mb4_bin'])]
    private string $email;

    #[ORM\Column(length: 64)]
    private string $tokenHash;

    #[ORM\Column(length: 10)]
    private string $status = self::PENDING;

    /** The role the invitee gets on accepting. */
    #[ORM\Column(length: 10, enumType: ClubRole::class)]
    private ClubRole $role = ClubRole::DEFAULT_INVITED;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column]
    private \DateTimeImmutable $expiresAt;

    /** When it was accepted or declined. */
    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $resolvedAt = null;

    public function __construct(Club $club, User $invitedBy, string $email, string $tokenHash, \DateTimeImmutable $now)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->club = $club;
        $this->invitedBy = $invitedBy;
        $this->email = $email;
        $this->tokenHash = $tokenHash;
        $this->createdAt = $now;
        $this->expiresAt = $now->modify('+'.self::TTL_DAYS.' days');
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getClub(): Club
    {
        return $this->club;
    }

    public function getInvitedBy(): ?User
    {
        return $this->invitedBy;
    }

    public function getEmail(): string
    {
        return $this->email;
    }

    public function getRole(): ClubRole
    {
        return $this->role;
    }

    public function setRole(ClubRole $role): static
    {
        $this->role = $role;

        return $this;
    }

    public function getTokenHash(): string
    {
        return $this->tokenHash;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): \DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function getResolvedAt(): ?\DateTimeImmutable
    {
        return $this->resolvedAt;
    }

    public function isExpired(\DateTimeImmutable $now): bool
    {
        return self::PENDING === $this->status && $this->expiresAt <= $now;
    }

    public function resolve(string $status, \DateTimeImmutable $now): void
    {
        $this->status = $status;
        $this->resolvedAt = $now;
    }

    /** New token, new 7 days (re-send after expiry), inviter of the re-send. */
    public function renew(User $invitedBy, string $tokenHash, \DateTimeImmutable $now): void
    {
        $this->invitedBy = $invitedBy;
        $this->tokenHash = $tokenHash;
        $this->createdAt = $now;
        $this->expiresAt = $now->modify('+'.self::TTL_DAYS.' days');
    }
}
