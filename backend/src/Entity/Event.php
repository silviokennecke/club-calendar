<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class Event
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Calendar::class, inversedBy: 'events')]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\ManyToOne(targetEntity: EventTemplate::class, inversedBy: 'events')]
    #[ORM\JoinColumn(name: 'event_template_id', nullable: true, onDelete: 'SET NULL')]
    private ?EventTemplate $template = null;

    #[ORM\ManyToOne(targetEntity: Location::class, inversedBy: 'events')]
    #[ORM\JoinColumn(name: 'location_id', nullable: true, onDelete: 'SET NULL')]
    private ?Location $location = null;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\Column(length: 100, nullable: true)]
    private ?string $timezone = null;

    #[ORM\Column(type: 'date_immutable')]
    private \DateTimeImmutable $date;

    #[ORM\Column(type: 'date_immutable', nullable: true)]
    private ?\DateTimeImmutable $dateEnd = null;

    #[ORM\Column(length: 5)]
    private string $timeBegin;

    #[ORM\Column(length: 5)]
    private string $timeEnd;

    #[ORM\Column]
    private bool $isAllDay = false;

    #[ORM\Column]
    private bool $isDraft = true;

    #[ORM\OneToMany(targetEntity: EventProperty::class, mappedBy: 'event', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $properties;

    #[ORM\OneToMany(targetEntity: EventFeature::class, mappedBy: 'event', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $features;

    #[ORM\OneToMany(targetEntity: EventTargetGroup::class, mappedBy: 'event', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $targetGroups;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->properties = new ArrayCollection();
        $this->features = new ArrayCollection();
        $this->targetGroups = new ArrayCollection();
    }

    public function getId(): string
    {
        return $this->id;
    }

    public function getCalendar(): Calendar
    {
        return $this->calendar;
    }

    public function setCalendar(Calendar $calendar): static
    {
        $this->calendar = $calendar;

        return $this;
    }

    public function getTemplate(): ?EventTemplate
    {
        return $this->template;
    }

    public function setTemplate(?EventTemplate $template): static
    {
        $this->template = $template;

        return $this;
    }

    public function getLocation(): ?Location
    {
        return $this->location;
    }

    public function setLocation(?Location $location): static
    {
        $this->location = $location;

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

    public function getDate(): \DateTimeImmutable
    {
        return $this->date;
    }

    public function setDate(\DateTimeImmutable $date): static
    {
        $this->date = $date;

        return $this;
    }

    public function getDateEnd(): ?\DateTimeImmutable
    {
        return $this->dateEnd;
    }

    public function setDateEnd(?\DateTimeImmutable $dateEnd): static
    {
        $this->dateEnd = $dateEnd;

        return $this;
    }

    public function getTimeBegin(): string
    {
        return $this->timeBegin;
    }

    public function setTimeBegin(string $timeBegin): static
    {
        $this->timeBegin = $timeBegin;

        return $this;
    }

    public function getTimeEnd(): string
    {
        return $this->timeEnd;
    }

    public function setTimeEnd(string $timeEnd): static
    {
        $this->timeEnd = $timeEnd;

        return $this;
    }

    public function isAllDay(): bool
    {
        return $this->isAllDay;
    }

    public function setIsAllDay(bool $isAllDay): static
    {
        $this->isAllDay = $isAllDay;

        return $this;
    }

    public function isDraft(): bool
    {
        return $this->isDraft;
    }

    public function setIsDraft(bool $isDraft): static
    {
        $this->isDraft = $isDraft;

        return $this;
    }

    /**
     * @return Collection<int, EventProperty>
     */
    public function getProperties(): Collection
    {
        return $this->properties;
    }

    /**
     * @return Collection<int, EventFeature>
     */
    public function getFeatures(): Collection
    {
        return $this->features;
    }

    /**
     * @return Collection<int, EventTargetGroup>
     */
    public function getTargetGroups(): Collection
    {
        return $this->targetGroups;
    }
}
