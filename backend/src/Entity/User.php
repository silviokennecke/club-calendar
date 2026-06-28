<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

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

    #[ORM\Column(length: 36, nullable: true)]
    private ?string $lastClubId = null;

    #[ORM\Column(length: 36, nullable: true)]
    private ?string $lastCalendarId = null;

    #[ORM\Column(length: 10)]
    private string $language = 'en';

    #[ORM\Column]
    private bool $isEmailVerified = false;

    #[ORM\Column]
    private \DateTimeImmutable $createdAt;

    #[ORM\OneToMany(targetEntity: ClubUser::class, mappedBy: 'user', cascade: ['persist', 'remove'])]
    private Collection $clubs;

    #[ORM\OneToMany(targetEntity: Passkey::class, mappedBy: 'user', cascade: ['persist', 'remove'])]
    private Collection $passkeys;

    #[ORM\OneToMany(targetEntity: OAuthAccount::class, mappedBy: 'user', cascade: ['persist', 'remove'])]
    private Collection $oauthAccounts;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->clubs = new ArrayCollection();
        $this->passkeys = new ArrayCollection();
        $this->oauthAccounts = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getId(): string
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

    public function getLastClubId(): ?string
    {
        return $this->lastClubId;
    }

    public function setLastClubId(?string $lastClubId): static
    {
        $this->lastClubId = $lastClubId;

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

    public function getLanguage(): string
    {
        return $this->language;
    }

    public function setLanguage(string $language): static
    {
        $this->language = $language;

        return $this;
    }

    public function isEmailVerified(): bool
    {
        return $this->isEmailVerified;
    }

    public function setIsEmailVerified(bool $isEmailVerified): static
    {
        $this->isEmailVerified = $isEmailVerified;

        return $this;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
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
