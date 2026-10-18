<?php

declare(strict_types=1);

namespace App\Entity;

use App\Repository\CalendarRepository;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity(repositoryClass: CalendarRepository::class)]
class Calendar
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Club::class, inversedBy: 'calendars')]
    #[ORM\JoinColumn(name: 'club_id', nullable: false, onDelete: 'CASCADE')]
    private Club $club;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\Column(length: 100, nullable: true)]
    private ?string $timezone = null;

    #[ORM\Column(nullable: true)]
    private ?\DateTimeImmutable $archivedAt = null;

    #[ORM\OneToMany(targetEntity: Property::class, mappedBy: 'calendar', cascade: ['persist', 'remove'])]
    private Collection $properties;

    #[ORM\OneToMany(targetEntity: Feature::class, mappedBy: 'calendar', cascade: ['persist', 'remove'])]
    private Collection $features;

    #[ORM\OneToMany(targetEntity: EventTemplate::class, mappedBy: 'calendar', cascade: ['persist', 'remove'])]
    private Collection $templates;

    #[ORM\OneToMany(targetEntity: Event::class, mappedBy: 'calendar', cascade: ['persist', 'remove'])]
    private Collection $events;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->properties = new ArrayCollection();
        $this->features = new ArrayCollection();
        $this->templates = new ArrayCollection();
        $this->events = new ArrayCollection();
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

    public function getTimezone(): ?string
    {
        return $this->timezone;
    }

    public function setTimezone(?string $timezone): static
    {
        $this->timezone = $timezone;

        return $this;
    }

    public function getArchivedAt(): ?\DateTimeImmutable
    {
        return $this->archivedAt;
    }

    public function setArchivedAt(?\DateTimeImmutable $archivedAt): static
    {
        $this->archivedAt = $archivedAt;

        return $this;
    }

    /**
     * @return Collection<int, Property>
     */
    public function getProperties(): Collection
    {
        return $this->properties;
    }

    /**
     * @return Collection<int, Feature>
     */
    public function getFeatures(): Collection
    {
        return $this->features;
    }

    /**
     * @return Collection<int, EventTemplate>
     */
    public function getTemplates(): Collection
    {
        return $this->templates;
    }

    /**
     * @return Collection<int, Event>
     */
    public function getEvents(): Collection
    {
        return $this->events;
    }
}
