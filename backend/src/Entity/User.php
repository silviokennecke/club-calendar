<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;

#[ORM\Entity]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\Column(length: 255, unique: true)]
    private string $email;

    #[ORM\Column(length: 255, nullable: true)]
    private ?string $password = null;

    #[ORM\Column(length: 20)]
    private string $dateFormat = 'dd.MM.yyyy';

    #[ORM\Column]
    private int $firstDayOfWeek = 1;

    #[ORM\Column(nullable: true)]
    private ?int $lastClubId = null;

    #[ORM\Column(nullable: true)]
    private ?int $lastCalendarId = null;

    #[ORM\OneToMany(targetEntity: ClubUser::class, mappedBy: 'user', cascade: ['persist', 'remove'])]
    private Collection $clubs;

    #[ORM\OneToMany(targetEntity: Passkey::class, mappedBy: 'user', cascade: ['persist', 'remove'])]
    private Collection $passkeys;

    #[ORM\OneToMany(targetEntity: OAuthAccount::class, mappedBy: 'user', cascade: ['persist', 'remove'])]
    private Collection $oauthAccounts;

    public function __construct()
    {
        $this->clubs = new ArrayCollection();
        $this->passkeys = new ArrayCollection();
        $this->oauthAccounts = new ArrayCollection();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): static
    {
        $this->name = $name;

        return $this;
    }

    public function getEmail(): string
    {
        return $this->email;
    }

    public function setEmail(string $email): static
    {
        $this->email = $email;

        return $this;
    }

    public function getPassword(): ?string
    {
        return $this->password;
    }

    public function setPassword(?string $password): static
    {
        $this->password = $password;

        return $this;
    }

    public function getDateFormat(): string
    {
        return $this->dateFormat;
    }

    public function setDateFormat(string $dateFormat): static
    {
        $this->dateFormat = $dateFormat;

        return $this;
    }

    public function getFirstDayOfWeek(): int
    {
        return $this->firstDayOfWeek;
    }

    public function setFirstDayOfWeek(int $firstDayOfWeek): static
    {
        $this->firstDayOfWeek = $firstDayOfWeek;

        return $this;
    }

    public function getLastClubId(): ?int
    {
        return $this->lastClubId;
    }

    public function setLastClubId(?int $lastClubId): static
    {
        $this->lastClubId = $lastClubId;

        return $this;
    }

    public function getLastCalendarId(): ?int
    {
        return $this->lastCalendarId;
    }

    public function setLastCalendarId(?int $lastCalendarId): static
    {
        $this->lastCalendarId = $lastCalendarId;

        return $this;
    }

    /**
     * @return Collection<int, ClubUser>
     */
    public function getClubs(): Collection
    {
        return $this->clubs;
    }

    /**
     * @return Collection<int, Passkey>
     */
    public function getPasskeys(): Collection
    {
        return $this->passkeys;
    }

    /**
     * @return Collection<int, OAuthAccount>
     */
    public function getOauthAccounts(): Collection
    {
        return $this->oauthAccounts;
    }

    // UserInterface implementation

    public function getRoles(): array
    {
        return ['ROLE_USER'];
    }

    public function eraseCredentials(): void
    {
    }

    public function getUserIdentifier(): string
    {
        return $this->email;
    }
}
