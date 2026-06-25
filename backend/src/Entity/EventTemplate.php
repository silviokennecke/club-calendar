<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class EventTemplate
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Calendar::class, inversedBy: 'templates')]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\ManyToOne(targetEntity: Location::class, inversedBy: 'templates')]
    #[ORM\JoinColumn(name: 'location_id', nullable: true, onDelete: 'SET NULL')]
    private ?Location $location = null;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\Column(length: 100)]
    private string $timezone;

    #[ORM\Column(length: 5)]
    private string $timeBegin;

    #[ORM\Column(length: 5)]
    private string $timeEnd;

    #[ORM\OneToMany(targetEntity: Event::class, mappedBy: 'template')]
    private Collection $events;

    #[ORM\OneToMany(targetEntity: EventTemplateProperty::class, mappedBy: 'template', cascade: ['persist', 'remove'])]
    private Collection $properties;

    #[ORM\OneToMany(targetEntity: EventTemplateFeature::class, mappedBy: 'template', cascade: ['persist', 'remove'])]
    private Collection $features;

    #[ORM\OneToMany(targetEntity: EventTemplateTargetGroup::class, mappedBy: 'template', cascade: ['persist', 'remove'])]
    private Collection $targetGroups;

    public function __construct()
    {
        $this->events = new ArrayCollection();
        $this->properties = new ArrayCollection();
        $this->features = new ArrayCollection();
        $this->targetGroups = new ArrayCollection();
    }

    public function getId(): ?int
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

    public function getTimezone(): string
    {
        return $this->timezone;
    }

    public function setTimezone(string $timezone): static
    {
        $this->timezone = $timezone;

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

    /**
     * @return Collection<int, Event>
     */
    public function getEvents(): Collection
    {
        return $this->events;
    }

    /**
     * @return Collection<int, EventTemplateProperty>
     */
    public function getProperties(): Collection
    {
        return $this->properties;
    }

    /**
     * @return Collection<int, EventTemplateFeature>
     */
    public function getFeatures(): Collection
    {
        return $this->features;
    }

    /**
     * @return Collection<int, EventTemplateTargetGroup>
     */
    public function getTargetGroups(): Collection
    {
        return $this->targetGroups;
    }
}
