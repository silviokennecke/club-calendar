<?php

declare(strict_types=1);

namespace App\Entity;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
class TargetGroup implements UpdateAudited
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

    #[ORM\OneToMany(targetEntity: EventTargetGroup::class, mappedBy: 'targetGroup', cascade: ['persist', 'remove'])]
    private Collection $events;

    #[ORM\OneToMany(targetEntity: EventTemplateTargetGroup::class, mappedBy: 'targetGroup', cascade: ['persist', 'remove'])]
    private Collection $templates;

    #[ORM\OneToMany(targetEntity: CalendarFeedTargetGroup::class, mappedBy: 'targetGroup', cascade: ['persist', 'remove'])]
    private Collection $feeds;

    public function __construct()
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->events = new ArrayCollection();
        $this->templates = new ArrayCollection();
        $this->feeds = new ArrayCollection();
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

    /**
     * @return Collection<int, EventTargetGroup>
     */
    public function getEvents(): Collection
    {
        return $this->events;
    }

    /**
     * @return Collection<int, EventTemplateTargetGroup>
     */
    public function getTemplates(): Collection
    {
        return $this->templates;
    }

    /**
     * @return Collection<int, CalendarFeedTargetGroup>
     */
    public function getFeeds(): Collection
    {
        return $this->feeds;
    }
}
