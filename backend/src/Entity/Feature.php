<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class Feature
{
    #[ORM\Id]
    #[ORM\Column(length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Calendar::class, inversedBy: 'features')]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\OneToMany(targetEntity: EventFeature::class, mappedBy: 'feature', cascade: ['persist', 'remove'])]
    private Collection $events;

    #[ORM\OneToMany(targetEntity: EventTemplateFeature::class, mappedBy: 'feature', cascade: ['persist', 'remove'])]
    private Collection $templates;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->events = new ArrayCollection();
        $this->templates = new ArrayCollection();
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

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): static
    {
        $this->name = $name;

        return $this;
    }

    /**
     * @return Collection<int, EventFeature>
     */
    public function getEvents(): Collection
    {
        return $this->events;
    }

    /**
     * @return Collection<int, EventTemplateFeature>
     */
    public function getTemplates(): Collection
    {
        return $this->templates;
    }
}
