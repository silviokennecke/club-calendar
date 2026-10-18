<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\ClubRole;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class ClubUser
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Club::class, inversedBy: 'users')]
    #[ORM\JoinColumn(name: 'club_id', onDelete: 'CASCADE')]
    private Club $club;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: User::class, inversedBy: 'clubs')]
    #[ORM\JoinColumn(name: 'user_id', onDelete: 'CASCADE')]
    private User $user;

    /**
     * The calendar this member opened last in this club. A plain ID without foreign key: a deleted (or
     * moved) calendar is simply ignored when the value is read (see ClubService::listClubs).
     */
    #[ORM\Column(length: 36, nullable: true)]
    private ?string $lastCalendarId = null;

    /**
     * The member's role. The property default only keeps fixtures and tests working (they expect full rights);
     * every production path (club creation, accepting an invitation) sets it explicitly.
     */
    #[ORM\Column(length: 10, enumType: ClubRole::class)]
    private ClubRole $role = ClubRole::ADMIN;

    public function getClub(): Club
    {
        return $this->club;
    }

    public function setClub(Club $club): static
    {
        $this->club = $club;

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

    public function getLastCalendarId(): ?string
    {
        return $this->lastCalendarId;
    }

    public function setLastCalendarId(?string $lastCalendarId): static
    {
        $this->lastCalendarId = $lastCalendarId;

        return $this;
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
}
