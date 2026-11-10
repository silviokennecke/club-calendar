<?php

declare(strict_types=1);

namespace App\Entity;

use App\Doctrine\Type\EncryptedFeedSecretType;
use App\Enum\FeedVisibility;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class CalendarFeed implements UpdateAudited
{
    use Trait\HasUpdateAudit;

    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Club::class)]
    #[ORM\JoinColumn(name: 'club_id', nullable: false, onDelete: 'CASCADE')]
    private Club $club;

    #[ORM\Column(length: 255)]
    private string $name;

    /** New feeds are CLUB ("Nur per Link"): reachable by link, not indexed. */
    #[ORM\Column(enumType: FeedVisibility::class, options: ['default' => 'CLUB'])]
    private FeedVisibility $visibility = FeedVisibility::CLUB;

    /** Stored encrypted (SecretCipher); the getter returns plaintext. */
    #[ORM\Column(type: EncryptedFeedSecretType::NAME, length: 255, unique: true)]
    private string $sharedSecret;

    #[ORM\OneToMany(targetEntity: CalendarFeedTargetGroup::class, mappedBy: 'feed', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $targetGroups;

    #[ORM\OneToMany(targetEntity: CalendarFeedCalendar::class, mappedBy: 'feed', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $calendars;

    public function __construct()
    {
        $this->calendars = new ArrayCollection();
        $this->id = Uuid::v7()->toRfc4122();
        $this->targetGroups = new ArrayCollection();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getClub(): Club
    {
        return $this->club;
    }

    public function setClub(Club $club): static
    {
        $this->club = $club;

        return $this;
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

    public function getVisibility(): FeedVisibility
    {
        return $this->visibility;
    }

    public function setVisibility(FeedVisibility $visibility): static
    {
        $this->visibility = $visibility;

        return $this;
    }

    /** Search engines may index PUBLIC feeds only; CLUB and PRIVATE are always noindex. */
    public function isIndexable(): bool
    {
        return FeedVisibility::PUBLIC === $this->visibility;
    }

    public function getSharedSecret(): string
    {
        return $this->sharedSecret;
    }

    public function setSharedSecret(string $sharedSecret): static
    {
        $this->sharedSecret = $sharedSecret;

        return $this;
    }

    /**
     * @return Collection<int, CalendarFeedTargetGroup>
     */
    public function getTargetGroups(): Collection
    {
        return $this->targetGroups;
    }

    /**
     * @return Collection<int, CalendarFeedCalendar>
     */
    public function getCalendars(): Collection
    {
        return $this->calendars;
    }
}
