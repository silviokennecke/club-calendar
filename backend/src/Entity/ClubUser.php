<?php

declare(strict_types=1);

namespace App\Entity;

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
}
