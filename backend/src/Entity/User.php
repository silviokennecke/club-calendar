<?php

declare(strict_types=1);

namespace App\Entity;

use App\Service\EmailAddress;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Uid\Uuid;
use Symfony\Component\Uid\UuidV7;

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

    /** OPAQUE registration record (192 B, see App\Opaque\RegistrationRecord); null until the user has registered one. */
    #[ORM\Column(type: Types::BINARY, length: 256, nullable: true)]
    private mixed $opaqueRecord = null;

    #[ORM\Column(type: Types::SMALLINT, nullable: true)]
    private ?int $opaqueVersion = null;

    #[ORM\Column(length: 16, nullable: true)]
    private ?string $opaqueKeyId = null;

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

    /**
     * Version of the sessions (access and refresh tokens carry it as claim "tv"). Raising it ends every
     * session issued before. A counter instead of a time cut-off: iat has one-second resolution, and a
     * token issued in the same second must be decided by the order of issue, not by the clock.
     */
    #[ORM\Column(options: ['default' => 0])]
    private int $tokenVersion = 0;

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

    /**
     * Dedicated path for an id fixed before the row exists (OPAQUE signup: the registration record is bound to the
     * id). The id must be a UUID v7 minted by the server; callers take it only from a signed state.
     */
    public static function withPresetId(string $id): self
    {
        if (!Uuid::isValid($id) || !Uuid::fromString($id) instanceof UuidV7 || $id !== Uuid::fromString($id)->toRfc4122()) {
            throw new \InvalidArgumentException('A preset user id must be a canonical UUID v7.');
        }
        $user = new self();
        $user->id = $id;

        return $user;
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
        $this->email = EmailAddress::normalize($email);

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

    /** A password sign-in credential exists: the legacy bcrypt hash or an OPAQUE record. */
    public function hasPasswordCredential(): bool
    {
        return null !== $this->password || null !== $this->getOpaqueRecord();
    }

    public function getOpaqueRecord(): ?string
    {
        $record = $this->opaqueRecord;
        if (is_resource($record)) {
            $record = stream_get_contents($record);
            $this->opaqueRecord = $record;
        }

        return is_string($record) ? $record : null;
    }

    public function getOpaqueVersion(): ?int
    {
        return $this->opaqueVersion;
    }

    public function getOpaqueKeyId(): ?string
    {
        return $this->opaqueKeyId;
    }

    public function setOpaque(#[\SensitiveParameter] string $record, int $version, string $keyId): static
    {
        $this->opaqueRecord = $record;
        $this->opaqueVersion = $version;
        $this->opaqueKeyId = $keyId;

        return $this;
    }

    public function clearOpaque(): static
    {
        $this->opaqueRecord = null;
        $this->opaqueVersion = null;
        $this->opaqueKeyId = null;

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

    public function getTokenVersion(): int
    {
        return $this->tokenVersion;
    }

    /** Ends all sessions issued so far; tokens issued afterwards carry the new version. */
    public function invalidateTokens(): static
    {
        ++$this->tokenVersion;

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
