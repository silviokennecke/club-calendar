<?php

declare(strict_types=1);

namespace App\Entity;

use App\Enum\FeedVisibility;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class CalendarFeed
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Calendar::class, inversedBy: 'feeds')]
    #[ORM\JoinColumn(name: 'calendar_id', nullable: false, onDelete: 'CASCADE')]
    private Calendar $calendar;

    #[ORM\Column(length: 255)]
    private string $name;

    #[ORM\Column(enumType: FeedVisibility::class)]
    private FeedVisibility $visibility = FeedVisibility::PRIVATE;

    #[ORM\Column(length: 255, unique: true)]
    private string $sharedSecret;

    #[ORM\OneToMany(targetEntity: CalendarFeedTargetGroup::class, mappedBy: 'feed', cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $targetGroups;

    public function __construct()
    {
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
}
